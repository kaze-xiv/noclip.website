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
import { FFXIVLgb, FFXIVMaterial, FFXIVModel, FFXIVSgb } from "../../rust/pkg";
import { shimLgb, shimSgb } from "./sgb";

const pathBase = "FFXIV";

export class FFXIVFilesystem {
    public models = new Map<string, FFXIVModel>();
    public terrains: { [key: string]: Terrain | undefined } = {};
    public textures: { [key: string]: Texture | undefined } = {};
    public materials = new Map<string, FFXIVMaterial>();
    public lgbs: { [key: string]: FFXIVLgb | undefined } = {};
    public sgbs: { [key: string]: FFXIVSgb | undefined } = {};
}


class FFXIVMapDesc implements SceneDesc {
    public filesystem: FFXIVFilesystem = new FFXIVFilesystem();

    constructor(public id: string, public name: string = id, public gobj_roots: number[] | null = null) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        rust.init_panic_hook();
        const dataFetcher = context.dataFetcher;
        const mapBase = `${this.id}`;

        console.time("Load terrain");
        const tera = await this.loadTerrainFile(dataFetcher, mapBase);
        console.timeEnd("Load terrain");

        const materialNames = new Set<string>();
        const materialsInTera = tera.models.flatMap(m => m?.meshes?.map(mesh => m.materials[mesh.get_material_index()]) ?? [])

        for (let i = 0; i < materialsInTera.length; i++)
            materialNames.add(materialsInTera[i]);

        console.time("Load LGB")
        const lgbNames = ["bg.lgb",
            "planmap.lgb",
            "planevent.lgb"
        ];
        const lgb = await Promise.all(lgbNames.map(lgb => this.loadLgb(dataFetcher, `${mapBase}/level/${lgb}`)));
        const modelPathssInLgb = [...new Set(lgb.flatMap(l => l.discoveredModels))];
        console.log("Discovered", modelPathssInLgb.length, "model files in lgbs");
        const modelsInLgb = await Promise.all([...modelPathssInLgb.values()].map(model => this.loadPart(dataFetcher, model)));
        const materialsInModelsInLgb = modelsInLgb.flatMap(model => model?.meshes?.map(mesh => model.materials[mesh.get_material_index()]) ?? []);
        for (let i = 0; i < materialsInModelsInLgb.length; i++) {
            materialNames.add(materialsInModelsInLgb[i]);
        }
        console.timeEnd("Load LGB")

        console.time("Load SGB")
        const sgbFiles = new Set(lgb.flatMap(l => l.discoveredSgbs));
        console.log("Discovered", sgbFiles.size, "sgb files in lgbs");
        const sgb = await Promise.all([...sgbFiles].map(sgb => this.loadSgb(dataFetcher, sgb)));
        const modelPathsInSgb = [...new Set(sgb.flatMap(l => l?.discoveredModels ?? []))];
        console.log("Discovered", modelPathsInSgb.length, "model files in sgbs");
        const modelsInSgb = await Promise.all([...modelPathsInSgb.values()].map(model => this.loadPart(dataFetcher, model)));
        const materialsInModelsInSgb = modelsInSgb.flatMap(model => model?.meshes?.map(mesh => model.materials[mesh.get_material_index()]) ?? []);
        for (let i = 0; i < materialsInModelsInSgb.length; i++) {
            materialNames.add(materialsInModelsInSgb[i]);
        }
        // what if we find more loll
        console.timeEnd("Load SGB")

        console.time("Load materials");
        const materials = await Promise.all([...materialNames.values()].map(mat => this.loadMaterial(dataFetcher, mat)));
        console.timeEnd("Load materials");

        // discover textures
        console.time("Load textures");
        const textureNames = new Set<string>(materials.flatMap(m => m.texture_names));
        const textures = await Promise.all([...textureNames.values()].map(t => this.loadTexture(dataFetcher, t)));
        console.timeEnd("Load textures");

        console.time("Process textures");
        const vTextures = processTextures(device, textures);
        console.timeEnd("Process textures");

        const scene = new FFXIVRenderer(device, tera, this.filesystem, lgb);
        scene.textureHolder = vTextures;
        return scene;
    }

    private async loadLgb(dataFetcher: DataFetcher, path: string): Promise<rust.FFXIVLgb> {
        const data = await dataFetcher.fetchData(`${pathBase}/${path}`);
        const lgb = shimLgb(rust.FFXIVLgb.parse(new Uint8Array(data.arrayBuffer)));
        this.filesystem.lgbs[path] = lgb;
        return lgb;
    }

    private async loadSgb(dataFetcher: DataFetcher, path: string): Promise<rust.FFXIVSgb | null> {
        const data = await dataFetcher.fetchData(`${pathBase}/${path}`);
        try {
            const sgb = shimSgb(rust.FFXIVSgb.parse(new Uint8Array(data.arrayBuffer)));
            this.filesystem.sgbs[path] = sgb;
            return sgb;
        } catch {
            console.log(`Failed to load sgb ${path}`)
            return null;
        }
    }

    private async loadTerrainFile(dataFetcher: DataFetcher, mapBase: string): Promise<Terrain> {
        const path = `${mapBase}/bgplate/terrain.tera`;
        const terrain = new Terrain(await dataFetcher.fetchData(`${pathBase}/${path}`));
        this.filesystem.terrains[path] = terrain;

        const files = range(0, terrain.plateCount);
        const partNames = files.map(i => {
            const fn = `${i}`.padStart(4, "0");
            return `${mapBase}/bgplate/${fn}.mdl`;
        });

        const models = await Promise.all(partNames.map(p => this.loadPart(dataFetcher, p)));
        terrain.models = models as FFXIVModel[]; // yuck
        return terrain;
    }

    private async loadPart(dataFetcher: DataFetcher, path: string): Promise<FFXIVModel | null> {
        const data = await dataFetcher.fetchData(`${pathBase}/${path}`, {allow404: true});
        const model = rust.FFXIVSceneManager.parse_mdl(new Uint8Array(data.arrayBuffer));
        if (!model) return null;
        this.filesystem.models.set(path, model);
        return model;
    }

    private async loadMaterial(dataFetcher: DataFetcher, path: string): Promise<rust.FFXIVMaterial> {
        const data = await dataFetcher.fetchData(`${pathBase}/${path}`);
        const realMat = rust.FFXIVMaterial.parse(new Uint8Array(data.arrayBuffer));
        // i'm paranoid about getter_with_clone now
        const shimMat = {
            texture_names: realMat.texture_names,
            shader_name: realMat.shader_name,
        } as rust.FFXIVMaterial;
        this.filesystem.materials.set(path, shimMat);
        return shimMat;
    }

    private async loadTexture(dataFetcher: DataFetcher, path: string): Promise<Texture> {
        const data = await dataFetcher.fetchData(`${pathBase}/${path}`);
        const texture = new Texture(data, path);
        this.filesystem.textures[path] = texture;
        return texture;
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