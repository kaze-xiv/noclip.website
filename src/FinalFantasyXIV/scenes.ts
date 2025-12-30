import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { SceneGfx } from "../viewer";

import { rust } from '../rustlib.js';
import { FFXIVRenderer, processTextures } from "./render";
import { range } from "../MathHelpers";
import { Terrain } from "./Terrain";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { Texture, TextureFormat } from "./Texture";
import { DataFetcher } from "../DataFetcher";
import { FFXIVLgb, FFXIVModel } from "../../rust/pkg";

const pathBase = "FFXIV";

export type FFXIVFile = Texture | Terrain | rust.FFXIVModel | rust.FFXIVMaterial | FFXIVLgb | null;
export type FFXIVFilesystem = {
    [path: string]: FFXIVFile | Texture[], // sorry
};


class FFXIVMapDesc implements SceneDesc {
    public filesystem: FFXIVFilesystem = {textures: []};

    constructor(public id: string, public name: string = id, public gobj_roots: number[] | null = null) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        rust.init_panic_hook();
        const dataFetcher = context.dataFetcher;
        const mapBase = `${this.id}`;
        const tera = await this.loadTerrainFile(dataFetcher, mapBase);

        // discover materials
        const materialNames = new Set<string>();
        const materialsInTera = tera.models.flatMap(m => m?.meshes?.map(mesh => m.materials[mesh.get_material_index()]) ?? [])

        for (let i = 0; i < materialsInTera.length; i++)
            materialNames.add(materialsInTera[i]);

        const lgbNames = ["bg.lgb",
            // "planmap.lgb",
            // "planevent.lgb"
        ];
        const lgb = await Promise.all(lgbNames.map(lgb => this.loadLgb(dataFetcher, `${mapBase}/level/${lgb}`)));
        const modelPathssInLgb = [...new Set(lgb.flatMap(l => l.discoveredModels))];
        const modelsInLgb = await Promise.all([...modelPathssInLgb.values()].map(model => this.loadPart(dataFetcher, model)));
        const materialsInModelsInLgb = modelsInLgb.flatMap(model => model?.meshes?.map(mesh => model.materials[mesh.get_material_index()]) ?? []);
        for (let i = 0; i < materialsInModelsInLgb.length; i++) {
            materialNames.add(materialsInModelsInLgb[i]);
        }

        const sgbFiles = new Set(lgb.flatMap(l => l.discoveredSgbs));
        const sgb = await Promise.all([...sgbFiles].map(sgb => this.loadSgb(dataFetcher, sgb)));
        const modelPathsInSgb = [...new Set(sgb.flatMap(l => l?.discoveredModels ?? []))];
        const modelsInSgb = await Promise.all([...modelPathsInSgb.values()].map(model => this.loadPart(dataFetcher, model)));
        const materialsInModelsInSgb = modelsInSgb.flatMap(model => model?.meshes?.map(mesh => model.materials[mesh.get_material_index()]) ?? []);
        for (let i = 0; i < materialsInModelsInSgb.length; i++) {
            materialNames.add(materialsInModelsInSgb[i]);
        }
        // what if we find more loll


        const materials = await Promise.all([...materialNames.values()].map(mat => this.loadMaterial(dataFetcher, mat)));

        // discover textures
        const textureNames = new Set<string>(materials.flatMap(m => m.texture_names));
        const textures = await Promise.all([...textureNames.values()].map(t => this.loadTexture(dataFetcher, t)));
        // for (let i = 0; i < textures.length; i++) {
        //     const texture = textures[i];
        //     if (texture.format == TextureFormat.BC7) { // no sw decoder in lib unfortunately
        //         const req = rust.FFXIVTexture.decode_bc7(new Uint8Array(texture.buffer.arrayBuffer)).buffer;
        //         texture.converted = {
        //             type: "RGBA",
        //             depth: texture.depth,
        //             pixels: new Uint8Array<ArrayBuffer>(req as ArrayBuffer),
        //             flag: "SRGB",
        //             height: texture.height,
        //             width: texture.width,
        //         };
        //     }
        // }

        const vTextures = processTextures(device, textures);

        // debugger;
        const scene = new FFXIVRenderer(device, tera, this.filesystem, lgb);
        scene.textureHolder = vTextures;
        return scene;
    }

    private async loadLgb(dataFetcher: DataFetcher, path: string): Promise<rust.FFXIVLgb> {
        const data = await dataFetcher.fetchData(`${pathBase}/${path}`);
        const lgb = rust.FFXIVLgb.parse(new Uint8Array(data.arrayBuffer))
        this.putFileInFilesystem(path, lgb);
        // console.log(lgb.dump())
        return lgb;
    }

    private async loadSgb(dataFetcher: DataFetcher, path: string): Promise<rust.FFXIVSgb | null> {
        const data = await dataFetcher.fetchData(`${pathBase}/${path}`);
        try {
            const lgb = rust.FFXIVSgb.parse(new Uint8Array(data.arrayBuffer))
            this.putFileInFilesystem(path, lgb);
            return lgb;
        } catch {
            console.log(`Failed to load sgb ${path}`)
            return null;
        }
    }

    private async loadTerrainFile(dataFetcher: DataFetcher, mapBase: string): Promise<Terrain> {
        const path = `${mapBase}/bgplate/terrain.tera`;
        const terrain = new Terrain(await dataFetcher.fetchData(`${pathBase}/${path}`));
        this.putFileInFilesystem(path, terrain);

        const files = range(0, terrain.plateCount);
        const partNames = files.map(i => {
            const fn = `${i}`.padStart(4, "0");
            return `${mapBase}/bgplate/${fn}.mdl`;
        });

        const models = await Promise.all(partNames.map(p => this.loadPart(dataFetcher, p)));
        terrain.models = models;
        return terrain;
    }

    private async loadPart(dataFetcher: DataFetcher, path: string): Promise<FFXIVModel | null> {
        const data = await dataFetcher.fetchData(`${pathBase}/${path}`, {allow404: true});
        const part = rust.FFXIVSceneManager.parse_mdl(new Uint8Array(data.arrayBuffer)) ?? null;
        this.putFileInFilesystem(path, part);
        return part;
    }

    private async loadMaterial(dataFetcher: DataFetcher, path: string): Promise<rust.FFXIVMaterial> {
        const data = await dataFetcher.fetchData(`${pathBase}/${path}`);
        const realMat = rust.FFXIVMaterial.parse(new Uint8Array(data.arrayBuffer));
        // i'm paranoid about getter_with_clone now
        const shimMat = {
            texture_names: realMat.texture_names,
            shader_name: realMat.shader_name,
        } as rust.FFXIVMaterial;
        this.putFileInFilesystem(path, shimMat);
        return shimMat;
    }

    private async loadTexture(dataFetcher: DataFetcher, path: string): Promise<Texture> {
        const data = await dataFetcher.fetchData(`${pathBase}/${path}`);
        const texture = new Texture(data, path);
        this.putFileInFilesystem(path, texture);
        return texture;
    }

    private putFileInFilesystem(path: string, file: FFXIVFile) {
        this.filesystem[path] = file;
    }
}

export interface TerrainPlateBuffers {
    [index: number]: ArrayBufferSlice;
}

const sceneDescs = [
    new FFXIVMapDesc(`bg/ffxiv/wil_w1/fld/w1f3`, "Eastern Thanalan"),
    new FFXIVMapDesc(`bg/ffxiv/sea_s1/twn/s1t2`, "Limsa Lominsa Lower Decks"),
    new FFXIVMapDesc(`bg/ffxiv/sea_s1/twn/s1t1`, "Limsa Lominsa Upper Decks"),
];

const id = `FinalFantasyXIV`;
const name = "Final Fantasy XIV";

export const sceneGroup: SceneGroup = {
    id, name, sceneDescs,
};