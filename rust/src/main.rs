use std::fs;
use std::io::Cursor;
use ironworks::file;
use ironworks::file::mdl::{Lod, ModelContainer};
use ironworks::file::mdl::VertexAttributeKind;

pub fn main() {
    let data = fs::read(
        "/data/Projects/noclip.website/rust/out/bg/ffxiv/sea_s1/twn/s1t1/bgplate/0002.mdl",
    )
        .unwrap();
    let cursor = Cursor::new(data);
    let container: ModelContainer = file::File::read(cursor).unwrap();
    let model = container.model(Lod::High);
    let meshes = model.meshes();
    let mesh = meshes.get(2).unwrap();

    let test = mesh.attributes().unwrap();
    let real = test.iter().find(|x| x.kind == VertexAttributeKind::Uv).unwrap();
    println!("{:?}", real);
}