use physis::common::Platform;
use physis::ReadableFile;
use physis::sgb::Sgb;
use wasm_bindgen::prelude::wasm_bindgen;
use crate::ffxiv::animate::AnimationController;
use crate::ffxiv::layer::layer::LayerWrapped;

#[wasm_bindgen(getter_with_clone)]
#[derive(Debug)]
pub struct FFXIVSgb {
    pub(crate) inner: Sgb,
    pub animation_controller: Option<AnimationController>,
}


#[wasm_bindgen]
impl FFXIVSgb {
    pub fn parse(data: Vec<u8>) -> FFXIVSgb {
        let sgb = Sgb::from_existing(Platform::Win32, data.as_slice()).unwrap();

        let animation_controller = AnimationController::new(&sgb);
        FFXIVSgb {
            inner: sgb,
            animation_controller,
        }
    }

    pub fn layers(&self) -> Vec<LayerWrapped> {
        return self.inner.sections.iter().flat_map(|x| &x.layer_groups).flat_map(|x| &x.layers)
            .map(|layer| LayerWrapped::from_physis(layer))
            .collect()
    }
}
