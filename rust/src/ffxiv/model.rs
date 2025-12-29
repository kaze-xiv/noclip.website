use crate::ffxiv::wasm::VertexWrapper;
use deku::writer::Writer;
use deku::DekuWriter;
use physis::model::{Part, MDL};
use std::io::Cursor;
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen(getter_with_clone)]
#[derive(Clone)]
pub struct FFXIVModel {
    pub meshes: Vec<MeshWrapper>,
    pub materials: Vec<String>,
}

impl FFXIVModel {
    pub fn parse(data: Vec<u8>) -> Option<FFXIVModel> {
        convert_mdl(data)
    }
}

fn convert_mdl(data: Vec<u8>) -> Option<FFXIVModel> {
    let mut mdl = MDL::from_existing(data.as_slice())?;

    let lod = mdl.lods.remove(0);
    let parts = lod.parts;
    let materials = mdl.material_names;
    Some(FFXIVModel {
        meshes: parts
            .into_iter()
            .map(|x| MeshWrapper { physis: x })
            .collect(),
        materials: materials,
    })
}

#[wasm_bindgen]
impl FFXIVModel {}

#[wasm_bindgen]
#[derive(Clone)]
pub struct MeshWrapper {
    physis: Part,
}

#[wasm_bindgen]
impl MeshWrapper {
    pub fn get_material_index(&self) -> u16 {
        self.physis.material_index
    }

    pub fn indices(&self) -> Vec<u16> {
        self.physis.indices.clone()
    }

    pub fn debug_vertices(&self) -> String {
        format!("{:?}", self.physis.vertices)
    }

    pub fn attributes(&self) -> Vec<u8> {
        let size = 23 * 4;
        let mut vec: Vec<u8> = Vec::with_capacity(size * self.physis.vertices.len());
        let mut cursor = Cursor::new(&mut vec);
        let mut writer = Writer::new(cursor);

        for vert in self.physis.vertices.iter() {
            vert.position.to_writer(&mut writer, ()).unwrap();
            vert.uv0.to_writer(&mut writer, ()).unwrap();
            vert.uv1.to_writer(&mut writer, ()).unwrap();
            vert.normal.to_writer(&mut writer, ()).unwrap();
            vert.bitangent.to_writer(&mut writer, ()).unwrap();
            vert.color.to_writer(&mut writer, ()).unwrap();
            vert.bone_weight.to_writer(&mut writer, ()).unwrap();
            vert.bone_id.to_writer(&mut writer, ()).unwrap();
        }
        vec
    }
    pub fn vertices(&self) -> Vec<VertexWrapper> {
        self.physis
            .vertices
            .iter()
            .map(|&x| VertexWrapper { inner: x })
            .collect()
    }
}
