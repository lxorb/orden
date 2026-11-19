use std::cell::RefCell;
use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, Ordering};

use windows::core::{s, Interface, Result, PCSTR};
use windows::Win32::Foundation::{HANDLE, HMODULE, HWND, LPARAM, RECT, WPARAM};
use windows::Win32::Graphics::Direct3D::Fxc::D3DCompile;
use windows::Win32::Graphics::Direct3D::*;
use windows::Win32::Graphics::Direct3D11::*;
use windows::Win32::Graphics::DirectComposition::*;
use windows::Win32::Graphics::Dxgi::Common::*;
use windows::Win32::Graphics::Dxgi::*;
use windows::Win32::System::Threading::{CreateEventW, SetEvent, WaitForSingleObject, INFINITE};
use windows::Win32::UI::WindowsAndMessaging::PostMessageW;

use crate::log;
use crate::win::{Config, WM_PRESENT};

const SHADER: &str = r#"
Texture2D appT : register(t0);
Texture2D pageT : register(t1);
cbuffer C : register(b0) { float4 hole0; float4 misc; };
struct V { float4 pos : SV_Position; nointerpolation float4 hole : HOLE; };
bool mark(int i, int row) { float4 s = appT.Load(int3(i, row, 0)); return abs(s.b * 255.0 - 90.0) < 0.5 && s.a > 0.99; }
float word(int i, int row) { float4 s = appT.Load(int3(i, row, 0)); return round(s.r * 255.0) * 256.0 + round(s.g * 255.0); }
V vs(uint id : SV_VertexID) {
  V o;
  float2 uv = float2((id << 1) & 2, id & 2);
  o.pos = float4(uv * float2(2.0, -2.0) + float2(-1.0, 1.0), 0.0, 1.0);
  o.hole = hole0;
  int row = int(misc.x);
  if (misc.y > 0.5 && mark(0, row) && mark(1, row) && mark(2, row) && mark(3, row))
    o.hole = float4(word(0, row), word(1, row), word(2, row), word(3, row));
  return o;
}
float4 ps(V i) : SV_Target {
  int2 p = int2(i.pos.xy);
  float4 a = appT.Load(int3(p, 0));
  int2 q = p - int2(i.hole.xy);
  float4 g = float4(0.0, 0.0, 0.0, 0.0);
  if (q.x >= 0 && q.y >= 0 && q.x < int(i.hole.z) && q.y < int(i.hole.w)) g = pageT.Load(int3(q, 0));
  return a + g * (1.0 - a.a);
}
"#;

#[derive(Default)]
struct Layer {
    tex: Option<ID3D11Texture2D>,
    srv: Option<ID3D11ShaderResourceView>,
    w: u32,
    h: u32,
    first_paint: i64,
}

struct Comp {
    device: ID3D11Device1,
    ctx: ID3D11DeviceContext,
    swap: IDXGISwapChain1,
    _dcomp: IDCompositionDevice,
    _target: IDCompositionTarget,
    _visual: IDCompositionVisual,
    rtv: ID3D11RenderTargetView,
    vs: ID3D11VertexShader,
    ps: ID3D11PixelShader,
    cb: ID3D11Buffer,
    query: ID3D11Query,
    layers: [Layer; 3],
    pending: bool,
    dirty: Vec<RECT>,
    first: bool,
    w: i32,
    h: i32,
    hole: (i32, i32, i32, i32),
    dirty_event: HANDLE,
    strip_due: bool,
}

thread_local! {
    static COMP: RefCell<Option<Comp>> = const { RefCell::new(None) };
}

static PRESENTED: AtomicBool = AtomicBool::new(false);
static mut REPLY: usize = 0;

fn luid(l: windows::Win32::Foundation::LUID) -> String {
    format!("{:08x}:{:08x}", l.HighPart as u32, l.LowPart)
}

fn name(d: &[u16]) -> String {
    let end = d.iter().position(|c| *c == 0).unwrap_or(d.len());
    String::from_utf16_lossy(&d[..end])
}

unsafe fn compile(entry: PCSTR, target: PCSTR) -> Result<Vec<u8>> {
    let mut code = None;
    let mut errors = None;
    let made = D3DCompile(
        SHADER.as_ptr() as *const c_void,
        SHADER.len(),
        s!("spike"),
        None,
        None,
        entry,
        target,
        0,
        0,
        &mut code,
        Some(&mut errors),
    );
    if let Err(e) = made {
        if let Some(errors) = errors {
            let text = std::slice::from_raw_parts(errors.GetBufferPointer() as *const u8, errors.GetBufferSize());
            log::line(format!(
                r#"{{"ev":"error","what":"shader","detail":"{}"}}"#,
                log::esc(&String::from_utf8_lossy(text))
            ));
        }
        return Err(e);
    }
    let code = code.unwrap();
    Ok(std::slice::from_raw_parts(code.GetBufferPointer() as *const u8, code.GetBufferSize()).to_vec())
}

pub fn init(hwnd: HWND, cfg: &Config) -> Result<()> {
    let comp = unsafe { make(hwnd, cfg)? };
    COMP.with(|c| *c.borrow_mut() = Some(comp));
    Ok(())
}

unsafe fn make(hwnd: HWND, cfg: &Config) -> Result<Comp> {
    let factory: IDXGIFactory2 = CreateDXGIFactory2(DXGI_CREATE_FACTORY_FLAGS(0))?;
    let mut i = 0;
    while let Ok(adapter) = factory.EnumAdapters1(i) {
        if let Ok(d) = adapter.GetDesc1() {
            log::line(format!(
                r#"{{"ev":"adapter","i":{i},"name":"{}","luid":"{}","vendor":{},"device":{},"flags":{},"vram":{}}}"#,
                log::esc(&name(&d.Description)),
                luid(d.AdapterLuid),
                d.VendorId,
                d.DeviceId,
                d.Flags,
                d.DedicatedVideoMemory
            ));
        }
        i += 1;
    }
    let levels = [D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0, D3D_FEATURE_LEVEL_10_1, D3D_FEATURE_LEVEL_10_0];
    let mut device: Option<ID3D11Device> = None;
    let mut ctx: Option<ID3D11DeviceContext> = None;
    let flags = D3D11_CREATE_DEVICE_BGRA_SUPPORT;
    if cfg.warp {
        D3D11CreateDevice(
            None::<&IDXGIAdapter>,
            D3D_DRIVER_TYPE_WARP,
            HMODULE::default(),
            flags,
            Some(&levels),
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            Some(&mut ctx),
        )?;
    } else {
        let adapter = factory.EnumAdapters1(0)?;
        D3D11CreateDevice(
            &adapter,
            D3D_DRIVER_TYPE_UNKNOWN,
            HMODULE::default(),
            flags,
            Some(&levels),
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            Some(&mut ctx),
        )?;
    }
    let device = device.unwrap();
    let ctx = ctx.unwrap();
    let dxgi: IDXGIDevice = device.cast()?;
    let ours = dxgi.GetAdapter()?.GetDesc()?;
    log::line(format!(
        r#"{{"ev":"device","name":"{}","luid":"{}","level":{},"warp":{}}}"#,
        log::esc(&name(&ours.Description)),
        luid(ours.AdapterLuid),
        device.GetFeatureLevel().0,
        cfg.warp
    ));
    let device1: ID3D11Device1 = device.cast()?;
    let desc = DXGI_SWAP_CHAIN_DESC1 {
        Width: cfg.w as u32,
        Height: cfg.h as u32,
        Format: DXGI_FORMAT_B8G8R8A8_UNORM,
        Stereo: false.into(),
        SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
        BufferUsage: DXGI_USAGE_RENDER_TARGET_OUTPUT,
        BufferCount: 2,
        Scaling: DXGI_SCALING_STRETCH,
        SwapEffect: DXGI_SWAP_EFFECT_FLIP_SEQUENTIAL,
        AlphaMode: DXGI_ALPHA_MODE_PREMULTIPLIED,
        Flags: DXGI_SWAP_CHAIN_FLAG_FRAME_LATENCY_WAITABLE_OBJECT.0 as u32,
    };
    let swap = factory.CreateSwapChainForComposition(&dxgi, &desc, None)?;
    let swap2: IDXGISwapChain2 = swap.cast()?;
    swap2.SetMaximumFrameLatency(1)?;
    let waitable = swap2.GetFrameLatencyWaitableObject();
    let dcomp: IDCompositionDevice = DCompositionCreateDevice(&dxgi)?;
    let target = dcomp.CreateTargetForHwnd(hwnd, true)?;
    let visual = dcomp.CreateVisual()?;
    visual.SetContent(&swap)?;
    target.SetRoot(&visual)?;
    dcomp.Commit()?;
    let back: ID3D11Texture2D = swap.GetBuffer(0)?;
    let mut rtv = None;
    device.CreateRenderTargetView(&back, None, Some(&mut rtv))?;
    let vs_code = compile(s!("vs"), s!("vs_4_0"))?;
    let ps_code = compile(s!("ps"), s!("ps_4_0"))?;
    let mut vs = None;
    device.CreateVertexShader(&vs_code, None, Some(&mut vs))?;
    let mut ps = None;
    device.CreatePixelShader(&ps_code, None, Some(&mut ps))?;
    let (hx, hy, hw, hh) = cfg.hole;
    let values: [f32; 8] = [
        hx as f32,
        hy as f32,
        hw as f32,
        hh as f32,
        cfg.h as f32,
        if cfg.strip { 1.0 } else { 0.0 },
        0.0,
        0.0,
    ];
    let cb_desc = D3D11_BUFFER_DESC {
        ByteWidth: 32,
        Usage: D3D11_USAGE_DEFAULT,
        BindFlags: D3D11_BIND_CONSTANT_BUFFER.0 as u32,
        ..Default::default()
    };
    let init = D3D11_SUBRESOURCE_DATA { pSysMem: values.as_ptr() as *const c_void, ..Default::default() };
    let mut cb = None;
    device.CreateBuffer(&cb_desc, Some(&init), Some(&mut cb))?;
    let mut query = None;
    device.CreateQuery(&D3D11_QUERY_DESC { Query: D3D11_QUERY_EVENT, MiscFlags: 0 }, Some(&mut query))?;
    let dirty_event = CreateEventW(None, false, false, None)?;
    let reply = CreateEventW(None, false, false, None)?;
    REPLY = reply.0 as usize;
    pacer(hwnd, waitable, dirty_event, reply);
    Ok(Comp {
        device: device1,
        ctx,
        swap,
        _dcomp: dcomp,
        _target: target,
        _visual: visual,
        rtv: rtv.unwrap(),
        vs: vs.unwrap(),
        ps: ps.unwrap(),
        cb: cb.unwrap(),
        query: query.unwrap(),
        layers: Default::default(),
        pending: false,
        dirty: Vec::new(),
        first: true,
        w: cfg.w,
        h: cfg.h,
        hole: cfg.hole,
        dirty_event,
        strip_due: cfg.strip,
    })
}

fn pacer(hwnd: HWND, waitable: HANDLE, dirty: HANDLE, reply: HANDLE) {
    let (h, wt, d, r) = (hwnd.0 as usize, waitable.0 as usize, dirty.0 as usize, reply.0 as usize);
    std::thread::spawn(move || unsafe {
        let mut slot = false;
        loop {
            if !slot {
                WaitForSingleObject(HANDLE(wt as *mut c_void), 1000);
                slot = true;
            }
            WaitForSingleObject(HANDLE(d as *mut c_void), INFINITE);
            if PostMessageW(Some(HWND(h as *mut c_void)), WM_PRESENT, WPARAM(0), LPARAM(0)).is_err() {
                return;
            }
            WaitForSingleObject(HANDLE(r as *mut c_void), 2000);
            if PRESENTED.swap(false, Ordering::SeqCst) {
                slot = false;
            }
        }
    });
}

pub fn on_present() {
    let did = COMP.with(|c| c.borrow_mut().as_mut().is_some_and(|c| unsafe { c.present() }));
    PRESENTED.store(did, Ordering::SeqCst);
    unsafe {
        let _ = SetEvent(HANDLE(REPLY as *mut c_void));
    }
}

#[derive(Clone, Copy)]
struct Area {
    x: i32,
    y: i32,
    w: i32,
    h: i32,
}

fn union(rects: &[cef::Rect]) -> Option<Area> {
    let mut out: Option<(i32, i32, i32, i32)> = None;
    for r in rects {
        if r.width <= 0 || r.height <= 0 {
            continue;
        }
        let (a, b, c, d) = (r.x, r.y, r.x + r.width, r.y + r.height);
        out = Some(match out {
            None => (a, b, c, d),
            Some((x0, y0, x1, y1)) => (x0.min(a), y0.min(b), x1.max(c), y1.max(d)),
        });
    }
    out.map(|(x0, y0, x1, y1)| Area { x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
}

fn clamp(a: Area, w: u32, h: u32) -> Area {
    let x0 = a.x.clamp(0, w as i32);
    let y0 = a.y.clamp(0, h as i32);
    let x1 = (a.x + a.w).clamp(0, w as i32);
    let y1 = (a.y + a.h).clamp(0, h as i32);
    Area { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

pub fn accelerated(role: u8, dirty: &[cef::Rect], info: &cef::AcceleratedPaintInfo) {
    COMP.with(|c| {
        if let Some(c) = c.borrow_mut().as_mut() {
            unsafe { c.accelerated(role, dirty, info) }
        }
    });
}

pub fn software(role: u8, dirty: &[cef::Rect], buffer: *const u8, width: i32, height: i32) {
    COMP.with(|c| {
        if let Some(c) = c.borrow_mut().as_mut() {
            unsafe { c.software(role, dirty, buffer, width, height) }
        }
    });
}

impl Comp {
    unsafe fn ensure(&mut self, role: u8, w: u32, h: u32, format: DXGI_FORMAT) -> Result<bool> {
        let layer = &mut self.layers[role as usize];
        if layer.tex.is_some() && layer.w == w && layer.h == h {
            return Ok(false);
        }
        let desc = D3D11_TEXTURE2D_DESC {
            Width: w,
            Height: h,
            MipLevels: 1,
            ArraySize: 1,
            Format: format,
            SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
            Usage: D3D11_USAGE_DEFAULT,
            BindFlags: D3D11_BIND_SHADER_RESOURCE.0 as u32,
            CPUAccessFlags: 0,
            MiscFlags: 0,
        };
        let mut tex = None;
        self.device.CreateTexture2D(&desc, None, Some(&mut tex))?;
        let tex = tex.unwrap();
        let mut srv = None;
        self.device.CreateShaderResourceView(&tex, None, Some(&mut srv))?;
        layer.tex = Some(tex);
        layer.srv = srv;
        layer.w = w;
        layer.h = h;
        if layer.first_paint == 0 {
            layer.first_paint = log::qpc();
        }
        log::line(format!(r#"{{"ev":"layer","v":{role},"w":{w},"h":{h},"format":{}}}"#, format.0));
        Ok(true)
    }

    unsafe fn accelerated(&mut self, role: u8, dirty: &[cef::Rect], info: &cef::AcceleratedPaintInfo) {
        let t0 = log::qpc();
        let handle = HANDLE(info.shared_texture_handle);
        let mut how = "open1";
        let shared: ID3D11Texture2D = match self.device.OpenSharedResource1(handle) {
            Ok(t) => t,
            Err(e1) => {
                let mut legacy: Option<ID3D11Texture2D> = None;
                match self.device.OpenSharedResource(handle, &mut legacy) {
                    Ok(()) if legacy.is_some() => {
                        how = "open";
                        legacy.unwrap()
                    }
                    other => {
                        log::line(format!(
                            r#"{{"ev":"openfail","v":{role},"t":{t0},"hr1":"{:08x}","hr":"{}"}}"#,
                            e1.code().0 as u32,
                            match other {
                                Err(e) => format!("{:08x}", e.code().0 as u32),
                                Ok(()) => "null".into(),
                            }
                        ));
                        return;
                    }
                }
            }
        };
        let t1 = log::qpc();
        let mut d = D3D11_TEXTURE2D_DESC::default();
        shared.GetDesc(&mut d);
        let fresh = match self.ensure(role, d.Width, d.Height, d.Format) {
            Ok(f) => f,
            Err(e) => {
                log::line(format!(r#"{{"ev":"error","what":"layer","detail":"{}"}}"#, log::esc(&e.to_string())));
                return;
            }
        };
        let e = &info.extra;
        let full = Area { x: 0, y: 0, w: d.Width as i32, h: d.Height as i32 };
        let cap = Area {
            x: e.capture_update_rect.x,
            y: e.capture_update_rect.y,
            w: e.capture_update_rect.width,
            h: e.capture_update_rect.height,
        };
        let damage = union(dirty);
        let (src, area) = if fresh {
            ("full", full)
        } else if e.has_capture_update_rect != 0 {
            ("cap", cap)
        } else if let Some(a) = damage {
            ("dirty", a)
        } else {
            ("full", full)
        };
        let area = clamp(area, d.Width, d.Height);
        let mut wait = 0;
        if area.w > 0 && area.h > 0 {
            let layer = self.layers[role as usize].tex.clone().unwrap();
            let bx = D3D11_BOX {
                left: area.x as u32,
                top: area.y as u32,
                front: 0,
                right: (area.x + area.w) as u32,
                bottom: (area.y + area.h) as u32,
                back: 1,
            };
            self.ctx.CopySubresourceRegion(&layer, 0, area.x as u32, area.y as u32, 0, &shared, 0, Some(&bx));
            self.ctx.End(&self.query);
            self.ctx.Flush();
            let tw = log::qpc();
            let limit = log::freq() / 2;
            loop {
                let mut done = windows::core::BOOL(0);
                let _ = self.ctx.GetData(
                    &self.query,
                    Some(&mut done as *mut _ as *mut c_void),
                    std::mem::size_of::<windows::core::BOOL>() as u32,
                    0,
                );
                if done.as_bool() {
                    break;
                }
                if log::qpc() - tw > limit {
                    log::line(r#"{"ev":"error","what":"copy fence timeout"}"#.into());
                    break;
                }
                std::thread::yield_now();
            }
            wait = log::qpc() - tw;
        }
        let t2 = log::qpc();
        let dmg = damage.map_or(0, |a| a.w as i64 * a.h as i64);
        log::line(format!(
            r#"{{"ev":"paint","v":{role},"acc":1,"t":{t0},"how":"{how}","src":"{src}","r":[{},{},{},{}],"bytes":{},"dmg":{dmg},"cap":{},"open":{},"copy":{},"wait":{},"fmt":{},"tw":{},"th":{}}}"#,
            area.x,
            area.y,
            area.w,
            area.h,
            area.w as i64 * area.h as i64 * 4,
            e.has_capture_update_rect,
            log::us(t1 - t0),
            log::us(t2 - t1),
            log::us(wait),
            *info.format.as_ref() as i32,
            d.Width,
            d.Height
        ));
        self.mark(role, area);
    }

    unsafe fn software(&mut self, role: u8, dirty: &[cef::Rect], buffer: *const u8, width: i32, height: i32) {
        let t0 = log::qpc();
        let fresh = match self.ensure(role, width as u32, height as u32, DXGI_FORMAT_B8G8R8A8_UNORM) {
            Ok(f) => f,
            Err(_) => return,
        };
        let full = Area { x: 0, y: 0, w: width, h: height };
        let area = if fresh { full } else { union(dirty).unwrap_or(full) };
        let area = clamp(area, width as u32, height as u32);
        if area.w > 0 && area.h > 0 {
            let layer = self.layers[role as usize].tex.clone().unwrap();
            let bx = D3D11_BOX {
                left: area.x as u32,
                top: area.y as u32,
                front: 0,
                right: (area.x + area.w) as u32,
                bottom: (area.y + area.h) as u32,
                back: 1,
            };
            let start = buffer.add(((area.y * width + area.x) * 4) as usize);
            self.ctx.UpdateSubresource(&layer, 0, Some(&bx), start as *const c_void, (width * 4) as u32, 0);
        }
        let t1 = log::qpc();
        log::line(format!(
            r#"{{"ev":"paint","v":{role},"acc":0,"t":{t0},"src":"dirty","r":[{},{},{},{}],"bytes":{},"copy":{}}}"#,
            area.x,
            area.y,
            area.w,
            area.h,
            area.w as i64 * area.h as i64 * 4,
            log::us(t1 - t0)
        ));
        self.mark(role, area);
    }

    unsafe fn mark(&mut self, role: u8, area: Area) {
        if area.w <= 0 || area.h <= 0 {
            return;
        }
        let (ox, oy, cw, ch) = if role == 2 { (self.hole.0, self.hole.1, self.hole.2, self.hole.3) } else { (0, 0, self.w, self.h) };
        let x0 = (area.x).clamp(0, cw) + ox;
        let y0 = (area.y).clamp(0, ch) + oy;
        let x1 = (area.x + area.w).clamp(0, cw) + ox;
        let y1 = (area.y + area.h).clamp(0, ch) + oy;
        let r = RECT { left: x0.clamp(0, self.w), top: y0.clamp(0, self.h), right: x1.clamp(0, self.w), bottom: y1.clamp(0, self.h) };
        if r.right > r.left && r.bottom > r.top {
            self.dirty.push(r);
            self.pending = true;
            let _ = SetEvent(self.dirty_event);
        }
    }

    unsafe fn check_strip(&mut self) {
        if !self.strip_due {
            return;
        }
        let layer = &self.layers[1];
        let Some(tex) = layer.tex.clone() else {
            return;
        };
        if layer.h as i32 <= self.h || log::qpc() - layer.first_paint < log::freq() * 2 {
            return;
        }
        self.strip_due = false;
        let mut d = D3D11_TEXTURE2D_DESC::default();
        tex.GetDesc(&mut d);
        let desc = D3D11_TEXTURE2D_DESC {
            Width: 8,
            Height: 1,
            MipLevels: 1,
            ArraySize: 1,
            Format: d.Format,
            SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
            Usage: D3D11_USAGE_STAGING,
            BindFlags: 0,
            CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
            MiscFlags: 0,
        };
        let mut staging = None;
        if self.device.CreateTexture2D(&desc, None, Some(&mut staging)).is_err() {
            return;
        }
        let staging = staging.unwrap();
        let bx = D3D11_BOX { left: 0, top: self.h as u32, front: 0, right: 8, bottom: self.h as u32 + 1, back: 1 };
        self.ctx.CopySubresourceRegion(&staging, 0, 0, 0, 0, &tex, 0, Some(&bx));
        let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
        if self.ctx.Map(&staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped)).is_err() {
            return;
        }
        let px = std::slice::from_raw_parts(mapped.pData as *const u8, 32).to_vec();
        self.ctx.Unmap(&staging, 0);
        let mut vals = Vec::new();
        let mut marked = true;
        for i in 0..4 {
            let (b, g, r, a) = (px[i * 4], px[i * 4 + 1], px[i * 4 + 2], px[i * 4 + 3]);
            marked &= b == 90 && a == 255;
            vals.push(r as i32 * 256 + g as i32);
        }
        let want = [self.hole.0, self.hole.1, self.hole.2, self.hole.3];
        log::line(format!(
            r#"{{"ev":"strip","vals":{:?},"want":{:?},"marked":{},"ok":{},"raw":{:?}}}"#,
            vals,
            want,
            marked,
            marked && vals == want,
            &px[..16]
        ));
    }

    unsafe fn present(&mut self) -> bool {
        if !self.pending {
            return false;
        }
        let t0 = log::qpc();
        let ctx = self.ctx.clone();
        ctx.OMSetRenderTargets(Some(&[Some(self.rtv.clone())]), None);
        ctx.RSSetViewports(Some(&[D3D11_VIEWPORT {
            TopLeftX: 0.0,
            TopLeftY: 0.0,
            Width: self.w as f32,
            Height: self.h as f32,
            MinDepth: 0.0,
            MaxDepth: 1.0,
        }]));
        ctx.IASetPrimitiveTopology(D3D_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
        ctx.IASetInputLayout(None);
        ctx.VSSetShader(&self.vs, None);
        ctx.PSSetShader(&self.ps, None);
        ctx.VSSetConstantBuffers(0, Some(&[Some(self.cb.clone())]));
        let srvs = [self.layers[1].srv.clone(), self.layers[2].srv.clone()];
        ctx.VSSetShaderResources(0, Some(&srvs));
        ctx.PSSetShaderResources(0, Some(&srvs));
        ctx.Draw(3, 0);
        self.check_strip();
        let mut rects = std::mem::take(&mut self.dirty);
        let area: i64 = rects.iter().map(|r| (r.right - r.left) as i64 * (r.bottom - r.top) as i64).sum();
        let params = DXGI_PRESENT_PARAMETERS {
            DirtyRectsCount: if self.first { 0 } else { rects.len() as u32 },
            pDirtyRects: if self.first { std::ptr::null_mut() } else { rects.as_mut_ptr() },
            pScrollRect: std::ptr::null_mut(),
            pScrollOffset: std::ptr::null_mut(),
        };
        let hr = self.swap.Present1(1, DXGI_PRESENT(0), &params);
        ctx.PSSetShaderResources(0, Some(&[None, None]));
        ctx.VSSetShaderResources(0, Some(&[None, None]));
        self.first = false;
        self.pending = false;
        let t1 = log::qpc();
        log::line(format!(
            r#"{{"ev":"present","t":{t0},"n":{},"area":{area},"us":{},"hr":"{:08x}"}}"#,
            rects.len(),
            log::us(t1 - t0),
            hr.0 as u32
        ));
        true
    }
}

