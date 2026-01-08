use deku::writer::Writer;
use deku::DekuWriter;
use physis::common::Platform;
use physis::model::{Part, Vertex, MDL};
use physis::ReadableFile;
use std::io::Cursor;
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen(getter_with_clone)]
#[derive(Clone)]
pub struct FFXIVModel {
    pub meshes: Vec<MeshWrapper>,
    pub materials: Vec<String>,
}

#[wasm_bindgen]
impl FFXIVModel {
    pub fn parse(data: Vec<u8>) -> Option<FFXIVModel> {
        let mut mdl = MDL::from_existing(Platform::Win32, data.as_slice())?;

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
}

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
        let cursor = Cursor::new(&mut vec);
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

#[wasm_bindgen]
pub struct VertexWrapper {
    #[wasm_bindgen(skip)]
    pub inner: Vertex,
}

#[wasm_bindgen]
impl VertexWrapper {
    pub fn position(&self) -> Vec<f32> {
        self.inner.position.to_vec()
    }
    pub fn uv0(&self) -> Vec<f32> {
        self.inner.uv0.to_vec()
    }

    pub fn uv1(&self) -> Vec<f32> {
        self.inner.uv1.to_vec()
    }

    pub fn normal(&self) -> Vec<f32> {
        self.inner.normal.to_vec()
    }

    pub fn bitangent(&self) -> Vec<f32> {
        self.inner.bitangent.to_vec()
    }

    pub fn color(&self) -> Vec<f32> {
        self.inner.color.to_vec()
    }

    pub fn bone_weight(&self) -> Vec<f32> {
        self.inner.bone_weight.to_vec()
    }

    pub fn bone_id(&self) -> Vec<u8> {
        self.inner.bone_id.to_vec()
    }
}
