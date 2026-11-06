use std::ffi::{c_char, CStr, CString};
use std::path::Path;

use libloading::Library;

use super::catalog::RUNTIME_VERSION;

#[repr(C)]
#[derive(Clone, Copy)]
struct FeatureConfig {
    sample_rate: i32,
    feature_dim: i32,
}

type Text = *const c_char;

#[repr(C)]
#[derive(Clone, Copy)]
struct Transducer {
    encoder: Text,
    decoder: Text,
    joiner: Text,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct Whisper {
    encoder: Text,
    decoder: Text,
    language: Text,
    task: Text,
    tail_paddings: i32,
    enable_token_timestamps: i32,
    enable_segment_timestamps: i32,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct SenseVoice {
    model: Text,
    language: Text,
    use_itn: i32,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct Canary {
    encoder: Text,
    decoder: Text,
    src_lang: Text,
    tgt_lang: Text,
    use_pnc: i32,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct FunAsrNano {
    encoder_adaptor: Text,
    llm: Text,
    embedding: Text,
    tokenizer: Text,
    system_prompt: Text,
    user_prompt: Text,
    max_new_tokens: i32,
    temperature: f32,
    top_p: f32,
    seed: i32,
    language: Text,
    itn: i32,
    hotwords: Text,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct Qwen3 {
    conv_frontend: Text,
    encoder: Text,
    decoder: Text,
    tokenizer: Text,
    max_total_len: i32,
    max_new_tokens: i32,
    temperature: f32,
    top_p: f32,
    seed: i32,
    hotwords: Text,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct Cohere {
    encoder: Text,
    decoder: Text,
    language: Text,
    use_punct: i32,
    use_itn: i32,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct ModelConfig {
    transducer: Transducer,
    paraformer: [Text; 1],
    nemo_ctc: [Text; 1],
    whisper: Whisper,
    tdnn: [Text; 1],
    tokens: Text,
    num_threads: i32,
    debug: i32,
    provider: Text,
    model_type: Text,
    modeling_unit: Text,
    bpe_vocab: Text,
    telespeech_ctc: Text,
    sense_voice: SenseVoice,
    moonshine: [Text; 5],
    fire_red_asr: [Text; 2],
    dolphin: [Text; 1],
    zipformer_ctc: [Text; 1],
    canary: Canary,
    wenet_ctc: [Text; 1],
    omnilingual: [Text; 1],
    medasr: [Text; 1],
    funasr_nano: FunAsrNano,
    fire_red_asr_ctc: [Text; 1],
    qwen3_asr: Qwen3,
    cohere_transcribe: Cohere,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct LmConfig {
    model: Text,
    scale: f32,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct CtcFst {
    graph: Text,
    max_active: i32,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct RecognizerConfig {
    feat_config: FeatureConfig,
    model_config: ModelConfig,
    lm_config: LmConfig,
    decoding_method: Text,
    max_active_paths: i32,
    hotwords_file: Text,
    hotwords_score: f32,
    rule_fsts: Text,
    rule_fars: Text,
    blank_penalty: f32,
    hr: [Text; 3],
    ctc_fst_decoder_config: CtcFst,
}

const HOTWORDS_SCORE: f32 = 1.5;

#[repr(C)]
struct RecognizerResult {
    text: Text,
}

enum Recognizer {}
enum Stream {}

type Version = unsafe extern "C" fn() -> Text;
type Create = unsafe extern "C" fn(*const RecognizerConfig) -> *const Recognizer;
type Destroy = unsafe extern "C" fn(*const Recognizer);
type NewStream = unsafe extern "C" fn(*const Recognizer) -> *const Stream;
type NewStreamWithHotwords = unsafe extern "C" fn(*const Recognizer, Text) -> *const Stream;
type DropStream = unsafe extern "C" fn(*const Stream);
type Accept = unsafe extern "C" fn(*const Stream, i32, *const f32, i32);
type Decode = unsafe extern "C" fn(*const Recognizer, *const Stream);
type GetResult = unsafe extern "C" fn(*const Stream) -> *const RecognizerResult;
type DropResult = unsafe extern "C" fn(*const RecognizerResult);

struct Calls {
    destroy: Destroy,
    stream: NewStream,
    stream_with_hotwords: NewStreamWithHotwords,
    drop_stream: DropStream,
    accept: Accept,
    decode: Decode,
    result: GetResult,
    drop_result: DropResult,
}

pub struct Engine {
    recognizer: *const Recognizer,
    calls: Calls,
    _libraries: [Library; 2],
}

#[allow(
    unsafe_code,
    reason = "a C object handed between threads behind a mutex"
)]
unsafe impl Send for Engine {}

pub struct Opening<'a> {
    pub files: &'a Path,
    pub threads: i32,
    pub provider: &'a str,
}

fn text(value: &str) -> Result<CString, String> {
    CString::new(value).map_err(|_| "a path with a null in it".to_owned())
}

fn path_text(folder: &Path, name: &str) -> Result<CString, String> {
    text(&folder.join(name).to_string_lossy())
}

#[allow(unsafe_code, reason = "loading a library runs its initialisers")]
fn load(path: &Path) -> Result<Library, String> {
    #[cfg(windows)]
    let library = unsafe {
        libloading::os::windows::Library::load_with_flags(
            path,
            libloading::os::windows::LOAD_WITH_ALTERED_SEARCH_PATH,
        )
        .map(Library::from)
    };
    #[cfg(not(windows))]
    let library = unsafe { Library::new(path) };
    library.map_err(|error| format!("the speech runtime could not be loaded: {error}"))
}

#[allow(
    unsafe_code,
    reason = "a symbol is read as the type its C header declares"
)]
fn symbol<T: Copy>(library: &Library, name: &[u8]) -> Result<T, String> {
    unsafe { library.get::<T>(name).map(|found| *found) }.map_err(|error| {
        format!(
            "the speech runtime has no {}: {error}",
            String::from_utf8_lossy(name)
        )
    })
}

impl Engine {
    #[allow(unsafe_code, reason = "sherpa-onnx's interface is C")]
    pub fn open(runtime: &Path, onnx: &str, api: &str, opening: &Opening) -> Result<Self, String> {
        let onnxruntime = load(&runtime.join(onnx))?;
        let library = load(&runtime.join(api))?;

        let version: Version = symbol(&library, b"SherpaOnnxGetVersionStr\0")?;
        let said = unsafe { CStr::from_ptr(version()) }
            .to_string_lossy()
            .into_owned();
        if said != RUNTIME_VERSION {
            return Err(format!(
                "the speech runtime is {said}, and this version of Orden reads {RUNTIME_VERSION}"
            ));
        }
        let create: Create = symbol(&library, b"SherpaOnnxCreateOfflineRecognizer\0")?;
        let calls = Calls {
            destroy: symbol(&library, b"SherpaOnnxDestroyOfflineRecognizer\0")?,
            stream: symbol(&library, b"SherpaOnnxCreateOfflineStream\0")?,
            stream_with_hotwords: symbol(&library, b"SherpaOnnxCreateOfflineStreamWithHotwords\0")?,
            drop_stream: symbol(&library, b"SherpaOnnxDestroyOfflineStream\0")?,
            accept: symbol(&library, b"SherpaOnnxAcceptWaveformOffline\0")?,
            decode: symbol(&library, b"SherpaOnnxDecodeOfflineStream\0")?,
            result: symbol(&library, b"SherpaOnnxGetOfflineStreamResult\0")?,
            drop_result: symbol(&library, b"SherpaOnnxDestroyOfflineRecognizerResult\0")?,
        };

        let folder = opening.files;
        let mut held: Vec<CString> = Vec::new();
        let mut keep = |value: CString| {
            let pointer = value.as_ptr();
            held.push(value);
            pointer
        };
        let mut config: RecognizerConfig = unsafe { std::mem::zeroed() };
        config.feat_config = FeatureConfig {
            sample_rate: 16_000,
            feature_dim: 80,
        };
        config.model_config.num_threads = opening.threads;
        config.model_config.provider = keep(text(opening.provider)?);
        config.model_config.transducer = Transducer {
            encoder: keep(path_text(folder, "encoder.int8.onnx")?),
            decoder: keep(path_text(folder, "decoder.int8.onnx")?),
            joiner: keep(path_text(folder, "joiner.int8.onnx")?),
        };
        config.model_config.tokens = keep(path_text(folder, "tokens.txt")?);
        config.model_config.model_type = keep(text("nemo_transducer")?);
        config.decoding_method = keep(text("modified_beam_search")?);
        config.max_active_paths = 4;
        config.hotwords_score = HOTWORDS_SCORE;
        config.model_config.modeling_unit = keep(text("bpe")?);
        config.model_config.bpe_vocab = keep(path_text(folder, "bpe.vocab")?);
        let recognizer = unsafe { create(&raw const config) };
        drop(held);
        if recognizer.is_null() {
            return Err("the speech model could not be opened".to_owned());
        }
        Ok(Self {
            recognizer,
            calls,
            _libraries: [library, onnxruntime],
        })
    }

    pub fn hear(&self, samples: &[f32], names: &str) -> Result<String, String> {
        let names: Vec<String> = names
            .lines()
            .map(|one| one.replace('/', " ").trim().to_owned())
            .filter(|one| !one.is_empty())
            .collect();
        if names.is_empty() {
            return self.pass(samples, None);
        }
        let biased = self.pass(samples, Some(&names.join("/")))?;
        if !repeats_a_name(&biased, &names) {
            return Ok(biased);
        }
        let plain = self.pass(samples, None)?;
        let count = |text: &str| text.split_whitespace().count();
        Ok(if count(&biased) <= count(&plain) + 1 {
            biased
        } else {
            plain
        })
    }

    #[allow(unsafe_code, reason = "sherpa-onnx's interface is C")]
    fn pass(&self, samples: &[f32], hotwords: Option<&str>) -> Result<String, String> {
        let count = i32::try_from(samples.len()).map_err(|_| "too long a stretch".to_owned())?;
        let c = &self.calls;
        let hotwords = hotwords.map(text).transpose()?;
        unsafe {
            let stream = match &hotwords {
                Some(words) => (c.stream_with_hotwords)(self.recognizer, words.as_ptr()),
                None => (c.stream)(self.recognizer),
            };
            if stream.is_null() {
                return Err("the speech model could not start a pass".to_owned());
            }
            (c.accept)(stream, 16_000, samples.as_ptr(), count);
            (c.decode)(self.recognizer, stream);
            let result = (c.result)(stream);
            let words = if result.is_null() || (*result).text.is_null() {
                String::new()
            } else {
                CStr::from_ptr((*result).text)
                    .to_string_lossy()
                    .trim()
                    .to_owned()
            };
            if !result.is_null() {
                (c.drop_result)(result);
            }
            (c.drop_stream)(stream);
            Ok(words)
        }
    }
}

fn words_of(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|one| !one.is_empty())
        .map(str::to_lowercase)
        .collect()
}

fn repeats_a_name(text: &str, names: &[String]) -> bool {
    let said = words_of(text);
    names.iter().any(|name| {
        let name = words_of(name);
        let twice = [name.as_slice(), name.as_slice()].concat();
        !name.is_empty() && said.windows(twice.len()).any(|run| run == twice.as_slice())
    })
}

impl Drop for Engine {
    #[allow(unsafe_code, reason = "sherpa-onnx's interface is C")]
    fn drop(&mut self) {
        unsafe { (self.calls.destroy)(self.recognizer) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(list: &[&str]) -> Vec<String> {
        list.iter().map(|one| (*one).to_owned()).collect()
    }

    #[test]
    fn a_name_said_over_and_over_is_caught() {
        let list = names(&["Daniel", "Sync Worker"]);
        assert!(repeats_a_name(
            "Daniel Daniel Daniel Can you summarize this note? Then draft a reply to Daniel?",
            &list
        ));
        assert!(repeats_a_name("Sync Worker, Sync Worker: deploy it", &list));
    }

    #[test]
    fn a_name_said_once_or_apart_is_not() {
        let list = names(&["Daniel", "Sync Worker"]);
        assert!(!repeats_a_name("Then draft a reply to Daniel.", &list));
        assert!(!repeats_a_name("Daniel asked, and Daniel said no", &list));
        assert!(!repeats_a_name("the Sync Worker and the worker", &list));
        assert!(!repeats_a_name("", &list));
    }
}
