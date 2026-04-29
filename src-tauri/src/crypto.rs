use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Nonce};
use argon2::Argon2;
use rand::RngCore;
use sha2::{Digest, Sha256};

const NONCE_SIZE: usize = 12;
const SALT_SIZE: usize = 32;

pub struct Vault {
    pub locked: bool,
    encryption_key: Option<[u8; 32]>,
    pub salt: Option<Vec<u8>>,
}

impl Vault {
    pub fn new() -> Self {
        Self { locked: true, encryption_key: None, salt: None }
    }

    pub fn is_locked(&self) -> bool { self.locked }

    pub fn unlock(&mut self, password: &str, salt: &[u8]) -> Result<(), String> {
        let key = derive_key(password, salt)?;
        self.encryption_key = Some(key);
        self.salt = Some(salt.to_vec());
        self.locked = false;
        Ok(())
    }

    pub fn lock(&mut self) {
        self.encryption_key = None;
        self.locked = true;
    }

    pub fn encrypt(&self, plaintext: &str) -> Result<String, String> {
        let key = self.encryption_key.as_ref().ok_or("Vault is locked")?;
        let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
        let mut nonce_bytes = [0u8; NONCE_SIZE];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);
        let ciphertext = cipher.encrypt(nonce, plaintext.as_bytes()).map_err(|e| e.to_string())?;
        let mut result = nonce_bytes.to_vec();
        result.extend_from_slice(&ciphertext);
        Ok(base64_encode(&result))
    }

    pub fn decrypt(&self, encrypted: &str) -> Result<String, String> {
        let key = self.encryption_key.as_ref().ok_or("Vault is locked")?;
        let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
        let data = base64_decode(encrypted).map_err(|e| e.to_string())?;
        if data.len() < NONCE_SIZE + 16 { return Err("Invalid ciphertext".into()); }
        let nonce = Nonce::from_slice(&data[..NONCE_SIZE]);
        let ciphertext = &data[NONCE_SIZE..];
        let plaintext = cipher.decrypt(nonce, ciphertext).map_err(|e| format!("Decryption failed: {}", e))?;
        String::from_utf8(plaintext).map_err(|e| e.to_string())
    }

    pub fn create_salt() -> Vec<u8> {
        let mut salt = [0u8; SALT_SIZE];
        OsRng.fill_bytes(&mut salt);
        salt.to_vec()
    }
}

fn derive_key(password: &str, salt: &[u8]) -> Result<[u8; 32], String> {
    let argon2 = Argon2::default();
    let mut key = [0u8; 32];
    argon2.hash_password_into(password.as_bytes(), salt, &mut key).map_err(|e| e.to_string())?;
    Ok(key)
}

pub fn hash_for_verification(password: &str, salt: &[u8]) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(salt);
    hasher.update(password.as_bytes());
    hasher.finalize().to_vec()
}

fn base64_encode(data: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(data)
}

fn base64_decode(s: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.decode(s).map_err(|e| e.to_string())
}
