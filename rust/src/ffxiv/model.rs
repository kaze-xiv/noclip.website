use std::collections::HashMap;
use std::fs;
use std::io::Cursor;
use ironworks::file;
use ironworks::file::mdl::{Lod, Mesh, Model, ModelContainer, VertexAttribute, VertexAttributeKind, VertexValues};
use ironworks::file::mdl::structs::VertexFormat;
use ironworks::file::mdl::VertexAttributeKind::{Normal, Position};
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
pub struct FFXIVModel {
    inner: Model,
}

impl FFXIVModel {
    pub fn parse(data: Vec<u8>) -> FFXIVModel {
        let cursor = Cursor::new(data);
        let container: ModelContainer = ironworks::file::File::read(cursor).unwrap();
        let model = container.model(Lod::High);
        FFXIVModel {
            inner: model,
        }
    }
}

#[wasm_bindgen]
impl FFXIVModel {
    #[wasm_bindgen]
    pub fn get_material(&self, index: u32) -> String {
        self.inner.meshes()[index as usize].material().unwrap()
    }

    #[wasm_bindgen]
    pub fn count_meshes(&self) -> u32 {
        self.inner.meshes().iter().count() as u32
    }

    #[wasm_bindgen]
    pub fn meshes(&self) -> Vec<MeshWrapper> {
        self.inner.meshes().into_iter().map(|x| MeshWrapper {
            inner: x,
        }).collect()
    }

    #[wasm_bindgen]
    pub fn get_triangles(&self, index: u32) -> Vec<u16> {
        self.inner.meshes()[index as usize].indices().unwrap()
    }
}

#[wasm_bindgen]
pub struct MeshWrapper {
    inner: Mesh,
}

#[wasm_bindgen]
impl MeshWrapper {

    pub fn get_material(&self) -> String {
        self.inner.material().unwrap()
    }

    pub fn get_position_format(&self) -> u8  {
        let mut x: HashMap<VertexAttributeKind, (VertexFormat, Vec<u8>)> = self.inner.dirty_attributes();
        x.remove(&VertexAttributeKind::Position).unwrap().0 as u8
    }
    pub fn get_position_buffer_f32(&self) -> Vec<f32> {
        let attr = self.inner.attributes().unwrap();
        let x = attr.iter().find(|x| x.kind == Position).unwrap();
        flatten_values(&x.values)
    }
    pub fn get_normal_buffer_f32(&self) -> Vec<f32> {
        let attr = self.inner.attributes().unwrap();
        let x = attr.iter().find(|x| x.kind == Normal).unwrap();
        flatten_values(&x.values)
    }
    pub fn get_position_buffer(&self) -> Vec<u8> {
        // let mut x: HashMap<VertexAttributeKind, (VertexFormat, Vec<u8>)> = self.inner.dirty_attributes();
        // x.remove(&VertexAttributeKind::Position).unwrap().1
        let attr = self.inner.attributes().unwrap();
        let x = attr.iter().find(|x| x.kind == Position).unwrap();
        match &x.values {
            VertexValues::Uint(u) => {
                let mut bytes = Vec::with_capacity(4 * u.len());

                for value in u {
                    bytes.extend(&value.to_le_bytes());
                }

                bytes
            },
            VertexValues::Vector2(v2) => {
                let mut bytes: Vec<u8> = Vec::with_capacity(64 * v2.len());

                for value in v2 {
                    bytes.extend(value[0].to_le_bytes());
                    bytes.extend(value[1].to_le_bytes());
                }

                bytes
            }
            VertexValues::Vector3(v3) => {
                let mut bytes: Vec<u8> = Vec::with_capacity(72 * v3.len());

                for value in v3 {
                    bytes.extend(value[0].to_le_bytes());
                    bytes.extend(value[1].to_le_bytes());
                    bytes.extend(value[2].to_le_bytes());
                }

                bytes
            }
            VertexValues::Vector4(v4) => {
                let mut bytes: Vec<u8> = Vec::with_capacity(128 * v4.len());

                for value in v4 {
                    bytes.extend(value[0].to_le_bytes());
                    bytes.extend(value[1].to_le_bytes());
                }

                bytes
            }
        }
    }

    pub fn get_normal_format(&self) -> u8 {
        let mut x: HashMap<VertexAttributeKind, (VertexFormat, Vec<u8>)> = self.inner.dirty_attributes();
        x.remove(&VertexAttributeKind::Normal).unwrap().0 as u8
    }
    pub fn get_normal_buffer(&self) -> Vec<u8> {
        let mut x: HashMap<VertexAttributeKind, (VertexFormat, Vec<u8>)> = self.inner.dirty_attributes();
        x.remove(&VertexAttributeKind::Normal).unwrap().1
    }
}

pub fn main() {
    let data = fs::read("/data/Projects/noclip.website/rust/out/bg/ffxiv/sea_s1/twn/s1t1/bgplate/0014.mdl").unwrap();
    let cursor = Cursor::new(data);
    let container: ModelContainer = file::File::read(cursor).unwrap();
    let model = container.model(Lod::High);
    let meshes = model.meshes();
    let mesh = meshes.get(2).unwrap();
    let dirty = mesh.dirty_attributes();
    println!("{:?}", dirty.get(&Position).unwrap());

    let test = mesh.attributes().unwrap();
    let real = test.iter().find(|x| x.kind == Position).unwrap();
    println!("{:?}", real);
}

fn flatten_values(values: &VertexValues) -> Vec<f32> {
    match values {
        VertexValues::Vector2(v2) => {
            let mut bytes: Vec<f32> = Vec::with_capacity(2 * v2.len());
            for value in v2 {
                bytes.extend(value);
            }
            bytes
        }
        VertexValues::Vector3(v3) => {
            let mut bytes: Vec<f32> = Vec::with_capacity(3 * v3.len());
            for value in v3 {
                bytes.extend(value);
            }
            bytes
        }
        VertexValues::Vector4(v4) => {
            let mut bytes: Vec<f32> = Vec::with_capacity(4 * v4.len());

            for value in v4 {
                bytes.extend(value);
            }

            bytes
        }
        _ => todo!()
    }
}
