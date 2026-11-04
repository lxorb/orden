//! A site's chain read over a connection of this module's own, for an `https:` page
//! whose engine says nothing of the certificates it came with.
//!
//! The handshake goes as far as the site sending its certificates, which are kept and
//! then refused, so the connection ends there: nothing is sent to the site, and nothing
//! here decides whether the chain is to be trusted. It is what the site serves now, over
//! the system's own route to it, which is the same chain as the page's nearly always and
//! not always - a site behind several servers, a proxy, a DNS the engine was given - so
//! the popover says where it came from.

use std::net::{TcpStream, ToSocketAddrs as _};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{ClientConfig, ClientConnection, DigitallySignedStruct, SignatureScheme};

/// How long the site is waited for, to connect and then to answer.
const PATIENCE: Duration = Duration::from_secs(5);

/// The chain the site at `address` sends, site first, or nothing where it could not be
/// reached.
pub async fn read(address: tauri::Url) -> Vec<Vec<u8>> {
    tauri::async_runtime::spawn_blocking(move || chain_of(&address).unwrap_or_default())
        .await
        .unwrap_or_default()
}

/// What a site's handshake sends of its certificates.
fn chain_of(address: &tauri::Url) -> Option<Vec<Vec<u8>>> {
    let host = address
        .host_str()?
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_owned();
    let port = address.port_or_known_default()?;
    let name = ServerName::try_from(host.as_str()).ok()?.to_owned();
    let heard = Arc::new(Heard::default());
    let config =
        ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
            .with_safe_default_protocol_versions()
            .ok()?
            .dangerous()
            .with_custom_certificate_verifier(Arc::clone(&heard) as Arc<dyn ServerCertVerifier>)
            .with_no_client_auth();
    let mut connection = ClientConnection::new(Arc::new(config), name).ok()?;
    let place = (host.as_str(), port).to_socket_addrs().ok()?.next()?;
    let mut socket = TcpStream::connect_timeout(&place, PATIENCE).ok()?;
    socket.set_read_timeout(Some(PATIENCE)).ok()?;
    socket.set_write_timeout(Some(PATIENCE)).ok()?;
    // Until the verifier has refused the chain, or the site has stopped answering.
    while connection.is_handshaking() && connection.complete_io(&mut socket).is_ok() {}
    let chain = std::mem::take(&mut *heard.chain.lock().unwrap_or_else(PoisonError::into_inner));
    Some(chain)
}

/// A verifier that keeps the chain it is shown and refuses it.
#[derive(Debug, Default)]
struct Heard {
    chain: Mutex<Vec<Vec<u8>>>,
}

/// Why the handshake stops: its certificates have been read, which is all it was for.
fn read_all() -> rustls::Error {
    rustls::Error::General("the certificates are read, which is all this was for".into())
}

impl ServerCertVerifier for Heard {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        _name: &ServerName<'_>,
        _ocsp: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        *self.chain.lock().unwrap_or_else(PoisonError::into_inner) = std::iter::once(end_entity)
            .chain(intermediates)
            .map(|one| one.as_ref().to_vec())
            .collect();
        Err(read_all())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _certificate: &CertificateDer<'_>,
        _signed: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Err(read_all())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _certificate: &CertificateDer<'_>,
        _signed: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Err(read_all())
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        rustls::crypto::ring::default_provider()
            .signature_verification_algorithms
            .supported_schemes()
    }
}

#[cfg(test)]
mod tests {
    use std::net::TcpListener;
    use std::sync::Arc;

    use base64::Engine as _;
    use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
    use rustls::{ServerConfig, ServerConnection};

    use super::super::x509::tests::{der, INTERMEDIATE, SITE};
    use super::chain_of;

    /// The key of the test chain's site certificate, made for these tests alone.
    const SITE_KEY: &str = "MC4CAQAwBQYDK2VwBCIEIAMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMD";

    #[test]
    fn the_chain_a_site_sends_is_read_and_nothing_more() {
        let key = base64::engine::general_purpose::STANDARD
            .decode(SITE_KEY)
            .expect("the test key");
        let config =
            ServerConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
                .with_safe_default_protocol_versions()
                .expect("versions")
                .with_no_client_auth()
                .with_single_cert(
                    vec![
                        CertificateDer::from(der(SITE)),
                        CertificateDer::from(der(INTERMEDIATE)),
                    ],
                    PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(key)),
                )
                .expect("a server");
        let listening = TcpListener::bind("127.0.0.1:0").expect("a port");
        let port = listening.local_addr().expect("its port").port();
        let serving = std::thread::spawn(move || {
            let (mut socket, _) = listening.accept().expect("a connection");
            let mut connection = ServerConnection::new(Arc::new(config)).expect("a connection");
            while connection.complete_io(&mut socket).is_ok() && connection.is_handshaking() {}
        });

        let address = tauri::Url::parse(&format!("https://127.0.0.1:{port}/")).expect("a url");
        let chain = chain_of(&address).expect("an answer");
        assert_eq!(chain, [der(SITE), der(INTERMEDIATE)]);
        serving.join().expect("the server");
    }

    #[test]
    fn a_site_that_is_not_there_has_no_chain() {
        let listening = TcpListener::bind("127.0.0.1:0").expect("a port");
        let port = listening.local_addr().expect("its port").port();
        drop(listening);
        let address = tauri::Url::parse(&format!("https://127.0.0.1:{port}/")).expect("a url");
        assert!(chain_of(&address).unwrap_or_default().is_empty());
    }
}
