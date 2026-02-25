use physis::{Platform, ReadableFile};
use physis::lvb::Lvb;
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen(getter_with_clone)]
#[derive(Debug)]
pub struct FFXIVLvb {
    pub(crate) inner: Lvb,
}


#[wasm_bindgen]
impl FFXIVLvb {
    pub fn parse(data: Vec<u8>) -> FFXIVLvb {
        let lvb = Lvb::from_existing(Platform::Win32, data.as_slice()).unwrap();
        FFXIVLvb { inner: lvb }
    }

    pub fn lgb_paths(&self) -> Vec<String> {
        self.inner.sections[0].lgb_paths.clone()
    }

    pub fn env_paths(&self) -> Vec<String> {
        self.inner.sections[0].general.env_spaces.iter().map(|x| x.env_path.value.clone()).collect()
    }

    pub fn bg_path(&self) -> String {
        self.inner.sections[0].general.bg_path.value.clone()
    }

}
