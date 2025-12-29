import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { SceneGfx } from "../viewer";
import { MeleeRenderer } from "../SuperSmashBrosMelee/Scenes_SuperSmashBrosMelee";

import { rust } from '../rustlib.js';
import { FFXIVRenderer } from "./render";
import { range } from "../MathHelpers";
import { leftPad } from "../util";
import { Terrain } from "./Terrain";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { Texture } from "./Texture";
import { DataFetcher } from "../DataFetcher";
import { FFXIVModel } from "../../rust/pkg";

const pathBase = "FFXIV"

export type FFXIVFile = Texture | Terrain | rust.FFXIVModel | rust.FFXIVMaterial;
export type FFXIVFilesystem = {
    textures: Texture[], // sorry
    [path: string]: FFXIVFile | Texture[], // sorry
};


class FFXIVMapDesc implements SceneDesc {
    public filesystem: FFXIVFilesystem = { textures: [] };
    constructor(public id: string, public name: string = id, public gobj_roots: number[] | null = null) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        rust.init_panic_hook();
        const dataFetcher = context.dataFetcher;
        const mapBase = `${this.id}`;
        const tera = await this.loadTerrainFile(dataFetcher, mapBase);
        const materialNames = new Set<string>(tera.models.flatMap(m => m.meshes.map(mesh => m.materials[mesh.get_material_index()])));
        const materials = await Promise.all([...materialNames.values()].map(mat => this.loadMaterial(dataFetcher, mat)));
        (window as any).shaders = [...new Set(materials.map(m => m.get_shader_name()))];
        (window as any).testMaterial = materials[0].get_texture_names();
        const textureNames = new Set<string>(materials.flatMap(m => m.get_texture_names()));
        const textures = await Promise.all([...textureNames.values()].map(t => this.loadTexture(dataFetcher, t)));

        this.filesystem.textures = [...textures];
        const scene = new FFXIVRenderer(device, tera, this.filesystem);
        return scene;
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

    private async loadPart(dataFetcher: DataFetcher, path: string): Promise<FFXIVModel> {
        const data = await dataFetcher.fetchData(`${pathBase}/${path}`);
        const part = rust.FFXIVSceneManager.parse_mdl(new Uint8Array(data.arrayBuffer))
        this.putFileInFilesystem(path, part);
        return part;
    }

    private async loadMaterial(dataFetcher: DataFetcher, path: string): Promise<rust.FFXIVMaterial> {
        const data = await dataFetcher.fetchData(`${pathBase}/${path}`);
        const mat = rust.FFXIVMaterial.parse(new Uint8Array(data.arrayBuffer));
        this.putFileInFilesystem(path, mat);
        return mat;
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