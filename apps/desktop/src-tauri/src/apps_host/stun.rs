use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, ToSocketAddrs, UdpSocket};
use std::time::{Duration, Instant};

pub const SERVER: &str = "stun.cloudflare.com:3478";
const WAIT: Duration = Duration::from_millis(400);

const MAGIC: u32 = 0x2112_a442;
const BINDING_REQUEST: u16 = 0x0001;
const BINDING_SUCCESS: u16 = 0x0101;
const XOR_MAPPED_ADDRESS: u16 = 0x0020;

pub fn request(id: [u8; 12]) -> [u8; 20] {
    let mut out = [0_u8; 20];
    out[..2].copy_from_slice(&BINDING_REQUEST.to_be_bytes());
    out[4..8].copy_from_slice(&MAGIC.to_be_bytes());
    out[8..].copy_from_slice(&id);
    out
}

pub fn mapped(answer: &[u8], id: [u8; 12]) -> Option<SocketAddr> {
    if answer.len() < 20
        || answer[..2] != BINDING_SUCCESS.to_be_bytes()
        || answer[4..8] != MAGIC.to_be_bytes()
        || answer[8..20] != id
    {
        return None;
    }
    let length = usize::from(u16::from_be_bytes([answer[2], answer[3]]));
    let body = answer.get(20..20 + length)?;
    let mut at = 0;
    while at + 4 <= body.len() {
        let kind = u16::from_be_bytes([body[at], body[at + 1]]);
        let size = usize::from(u16::from_be_bytes([body[at + 2], body[at + 3]]));
        let value = body.get(at + 4..at + 4 + size)?;
        if kind == XOR_MAPPED_ADDRESS {
            return xor_address(value, id);
        }
        at += 4 + size.div_ceil(4) * 4;
    }
    None
}

fn xor_address(value: &[u8], id: [u8; 12]) -> Option<SocketAddr> {
    let magic = MAGIC.to_be_bytes();
    let port = u16::from_be_bytes([value.get(2)? ^ magic[0], value.get(3)? ^ magic[1]]);
    match value.get(1)? {
        0x01 => {
            let raw = value.get(4..8)?;
            let mut ip = [0_u8; 4];
            for (at, byte) in ip.iter_mut().enumerate() {
                *byte = raw[at] ^ magic[at];
            }
            Some(SocketAddr::new(IpAddr::V4(Ipv4Addr::from(ip)), port))
        }
        0x02 => {
            let raw = value.get(4..20)?;
            let mask: Vec<u8> = magic.iter().chain(id.iter()).copied().collect();
            let mut ip = [0_u8; 16];
            for (at, byte) in ip.iter_mut().enumerate() {
                *byte = raw[at] ^ mask[at];
            }
            Some(SocketAddr::new(IpAddr::V6(Ipv6Addr::from(ip)), port))
        }
        _ => None,
    }
}

pub fn reflexive(socket: &UdpSocket, server: &str) -> Option<SocketAddr> {
    let local = socket.local_addr().ok()?;
    let server = server
        .to_socket_addrs()
        .ok()?
        .find(|one| one.is_ipv4() == local.is_ipv4())?;
    let mut id = [0_u8; 12];
    getrandom::fill(&mut id).ok()?;
    socket.send_to(&request(id), server).ok()?;
    let until = Instant::now() + WAIT;
    let mut buffer = [0_u8; 1500];
    loop {
        let left = until.checked_duration_since(Instant::now())?;
        socket
            .set_read_timeout(Some(left.max(Duration::from_millis(1))))
            .ok()?;
        let (length, from) = socket.recv_from(&mut buffer).ok()?;
        if from != server {
            continue;
        }
        let found = mapped(&buffer[..length], id)?;
        return (found != local).then_some(found);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: [u8; 12] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

    fn success(addr: SocketAddr, before: &[u8]) -> Vec<u8> {
        let magic = MAGIC.to_be_bytes();
        let mut value = vec![0_u8];
        let port = addr.port().to_be_bytes();
        match addr.ip() {
            IpAddr::V4(ip) => {
                value.push(0x01);
                value.extend_from_slice(&[port[0] ^ magic[0], port[1] ^ magic[1]]);
                value.extend(ip.octets().iter().zip(magic).map(|(a, b)| a ^ b));
            }
            IpAddr::V6(ip) => {
                value.push(0x02);
                value.extend_from_slice(&[port[0] ^ magic[0], port[1] ^ magic[1]]);
                let mask: Vec<u8> = magic.iter().chain(ID.iter()).copied().collect();
                value.extend(ip.octets().iter().zip(mask).map(|(a, b)| a ^ b));
            }
        }
        let mut body = before.to_vec();
        body.extend_from_slice(&XOR_MAPPED_ADDRESS.to_be_bytes());
        body.extend_from_slice(&u16::try_from(value.len()).unwrap().to_be_bytes());
        body.extend_from_slice(&value);
        let mut out = BINDING_SUCCESS.to_be_bytes().to_vec();
        out.extend_from_slice(&u16::try_from(body.len()).unwrap().to_be_bytes());
        out.extend_from_slice(&magic);
        out.extend_from_slice(&ID);
        out.extend_from_slice(&body);
        out
    }

    #[test]
    fn asks_for_a_binding_with_the_magic_cookie() {
        let asked = request(ID);
        assert_eq!(&asked[..4], &[0, 1, 0, 0]);
        assert_eq!(&asked[4..8], &[0x21, 0x12, 0xa4, 0x42]);
        assert_eq!(&asked[8..], &ID);
    }

    #[test]
    fn reads_the_mapped_address_past_another_attribute() {
        let v4: SocketAddr = "203.0.113.7:54321".parse().unwrap();
        let software = [0x80, 0x22, 0, 5, b'h', b'e', b'l', b'l', b'o', 0, 0, 0];
        assert_eq!(mapped(&success(v4, &software), ID), Some(v4));
        let v6: SocketAddr = "[2001:db8::1]:3478".parse().unwrap();
        assert_eq!(mapped(&success(v6, &[]), ID), Some(v6));
    }

    #[test]
    fn takes_no_answer_to_another_question() {
        let v4: SocketAddr = "203.0.113.7:1".parse().unwrap();
        let answer = success(v4, &[]);
        assert_eq!(mapped(&answer, [0; 12]), None);
        assert_eq!(mapped(&answer[..19], ID), None);
        let mut cut = answer.clone();
        cut.truncate(answer.len() - 2);
        assert_eq!(mapped(&cut, ID), None);
    }

    #[test]
    fn learns_the_address_a_server_sees() {
        let server = UdpSocket::bind("127.0.0.1:0").unwrap();
        let at = server.local_addr().unwrap();
        let seen: SocketAddr = "198.51.100.9:40000".parse().unwrap();
        let answering = std::thread::spawn(move || {
            let mut buffer = [0_u8; 1500];
            let (_, from) = server.recv_from(&mut buffer).unwrap();
            let mut id = [0_u8; 12];
            id.copy_from_slice(&buffer[8..20]);
            let mut answer = success(seen, &[]);
            answer[8..20].copy_from_slice(&id);
            server.send_to(&answer, from).unwrap();
        });
        let socket = UdpSocket::bind("127.0.0.1:0").unwrap();
        assert_eq!(reflexive(&socket, &at.to_string()), Some(seen));
        answering.join().unwrap();
    }
}
