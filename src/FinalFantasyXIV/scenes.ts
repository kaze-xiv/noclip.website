import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { SceneGfx } from "../viewer";

import { rust } from '../rustlib.js';
import { FFXIVRenderer, processTextures } from "./render";
import { range } from "../MathHelpers";
import { Terrain } from "./Terrain";
import { Texture } from "./Texture";
import { DataFetcher } from "../DataFetcher";
import { FFXIVModel } from "../../rust/pkg";
import { shimLgb, shimSgb } from "./sgb";
import { FFXIVFilesystem } from "./Filesystem";

const pathBase = "FFXIV";


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
        const loadedSgbFiles = new Set<string>();
        let sgbFiles = new Set(lgb.flatMap(l => l.discoveredSgbs));
        let foundMore = true;
        while (foundMore) {
            foundMore = false;
            console.log("Discovered", sgbFiles.size, "sgb files in lgbs");
            const sgbF = [...sgbFiles];
            for (let i = 0; i < sgbF.length; i++) {
                loadedSgbFiles.add(sgbF[i]);
            }
            const sgb = await Promise.all([...sgbFiles].map(sgb => this.loadSgb(dataFetcher, sgb)));
            const modelPathsInSgb = [...new Set(sgb.flatMap(l => l?.discoveredModels ?? []))];
            console.log("Discovered", modelPathsInSgb.length, "model files in sgbs");
            const modelsInSgb = await Promise.all([...modelPathsInSgb.values()].map(model => this.loadPart(dataFetcher, model)));
            const materialsInModelsInSgb = modelsInSgb.flatMap(model => model?.meshes?.map(mesh => model.materials[mesh.get_material_index()]) ?? []);
            for (let i = 0; i < materialsInModelsInSgb.length; i++) {
                materialNames.add(materialsInModelsInSgb[i]);
            }

            const moreSgb = new Set<string>(sgb.flatMap(s => s?.discoveredSgbs ?? []));
            const notDone = ((moreSgb as any).difference)(loadedSgbFiles) as Set<string>;
            if (notDone.size > 0) {
                sgbFiles = notDone;
                foundMore = true;
            }

        }
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
        const exists = this.filesystem.models.get(path)
        if (exists) return exists;
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

const sceneDescs = [
    new FFXIVMapDesc(`bg/ffxiv/fst_f1/twn/f1t1`, "The Black Shroud - New Gridania"),
    new FFXIVMapDesc(`bg/ffxiv/fst_f1/twn/f1t2`, "The Black Shroud - Old Gridania"),
    new FFXIVMapDesc(`bg/ffxiv/fst_f1/fld/f1f1`, "The Black Shroud - Central Shroud"),
    new FFXIVMapDesc(`bg/ffxiv/fst_f1/fld/f1f2`, "The Black Shroud - East Shroud"),
    new FFXIVMapDesc(`bg/ffxiv/fst_f1/fld/f1f3`, "The Black Shroud - South Shroud"),
    new FFXIVMapDesc(`bg/ffxiv/fst_f1/fld/f1f4`, "The Black Shroud - North Shroud"),
    new FFXIVMapDesc(`bg/ffxiv/fst_f1/dun/f1d1`, "The Black Shroud - The Tam-Tara Deepcroft"),
    new FFXIVMapDesc(`bg/ffxiv/fst_f1/rad/f1r1`, "The Black Shroud - The Thousand Maws of Toto-Rak"),
    new FFXIVMapDesc(`bg/ffxiv/zon_z1/jai/z1j1`, "??? - Mordion Gaol"),
    new FFXIVMapDesc(`bg/ffxiv/sea_s1/twn/s1t1`, "La Noscea - Limsa Lominsa Upper Decks"),
    new FFXIVMapDesc(`bg/ffxiv/sea_s1/twn/s1t2`, "La Noscea - Limsa Lominsa Lower Decks"),
    new FFXIVMapDesc(`bg/ffxiv/wil_w1/twn/w1t1`, "Thanalan - Ul'dah - Steps of Nald"),
    new FFXIVMapDesc(`bg/ffxiv/wil_w1/twn/w1t2`, "Thanalan - Ul'dah - Steps of Thal"),
    new FFXIVMapDesc(`bg/ffxiv/sea_s1/fld/s1f1`, "La Noscea - Middle La Noscea"),
    new FFXIVMapDesc(`bg/ffxiv/sea_s1/fld/s1f2`, "La Noscea - Lower La Noscea"),
    new FFXIVMapDesc(`bg/ffxiv/sea_s1/fld/s1f3`, "La Noscea - Eastern La Noscea"),
    new FFXIVMapDesc(`bg/ffxiv/sea_s1/fld/s1f4`, "La Noscea - Western La Noscea"),
    new FFXIVMapDesc(`bg/ffxiv/sea_s1/fld/s1f5`, "La Noscea - Upper La Noscea"),
    new FFXIVMapDesc(`bg/ffxiv/wil_w1/fld/w1f1`, "Thanalan - Western Thanalan"),
    new FFXIVMapDesc(`bg/ffxiv/wil_w1/fld/w1f2`, "Thanalan - Central Thanalan"),
    new FFXIVMapDesc(`bg/ffxiv/wil_w1/fld/w1f3`, "Thanalan - Eastern Thanalan"),
    new FFXIVMapDesc(`bg/ffxiv/wil_w1/fld/w1f4`, "Thanalan - Southern Thanalan"),
    new FFXIVMapDesc(`bg/ffxiv/wil_w1/fld/w1f5`, "Thanalan - Northern Thanalan"),
    new FFXIVMapDesc(`bg/ffxiv/lak_l1/fld/l1f1`, "Mor Dhona - Mor Dhona"),
    new FFXIVMapDesc(`bg/ffxiv/sea_s1/twn/s1ti`, "La Noscea - Mizzenmast Inn"),
    new FFXIVMapDesc(`bg/ffxiv/wil_w1/twn/w1ti`, "Thanalan - The Hourglass"),
    new FFXIVMapDesc(`bg/ffxiv/fst_f1/twn/f1ti`, "The Black Shroud - The Roost"),
    new FFXIVMapDesc(`bg/ffxiv/sea_s1/fld/s1f6`, "La Noscea - Outer La Noscea"),
    new FFXIVMapDesc(`bg/ffxiv/sea_s1/dun/s1d1`, "La Noscea - Sastasha"),
    new FFXIVMapDesc(`bg/ffxiv/sea_s1/dun/s1d3`, "La Noscea - The Wanderer's Palace"),
    new FFXIVMapDesc(`bg/ffxiv/sea_s1/fld/s1fa`, "La Noscea - The Navel"),
    new FFXIVMapDesc(`bg/ffxiv/wil_w1/dun/w1d1`, "Thanalan - Copperbell Mines"),
    new FFXIVMapDesc(`bg/ffxiv/wil_w1/fld/w1fa`, "Thanalan - Bowl of Embers"),
    new FFXIVMapDesc(`bg/ffxiv/fst_f1/fld/f1fa`, "The Black Shroud - Thornmarch"),
    new FFXIVMapDesc(`bg/ffxiv/roc_r1/dun/r1d1`, "Coerthas - Stone Vigil"),
    new FFXIVMapDesc(`bg/ffxiv/roc_r1/rad/r1r2`, "Coerthas - Aurum Vale"),
    new FFXIVMapDesc(`bg/ffxiv/roc_r1/fld/r1fa`, "Coerthas - The Howling Eye"),
    new FFXIVMapDesc(`bg/ffxiv/wil_w1/dun/w1d1`, "Thanalan - Copperbell Mines"),
    new FFXIVMapDesc(`bg/ffxiv/wil_w1/dun/w1d1`, "Thanalan - Copperbell Mines"),
    new FFXIVMapDesc(`bg/ffxiv/sea_s1/dun/s1d2`, "La Noscea - Brayflox's Longstop"),
    new FFXIVMapDesc(`bg/ffxiv/wil_w1/dun/w1d2`, "Thanalan - Halatali"),
    new FFXIVMapDesc(`bg/ffxiv/wil_w1/dun/w1d4`, "Thanalan - Castrum Meridianum"),
    new FFXIVMapDesc(`bg/ffxiv/fst_f1/dun/f1d2`, "The Black Shroud - Haukke Manor"),
    new FFXIVMapDesc(`bg/ffxiv/fst_f1/dun/f1d3`, "The Black Shroud - Amdapor Keep"),
    new FFXIVMapDesc(`bg/ffxiv/roc_r1/rad/r1r1`, "Coerthas - Dzemael Darkhold"),
    new FFXIVMapDesc(`bg/ffxiv/sea_s1/pvp/s1p1`, "La Noscea - Wolves' Den Pier"),
    new FFXIVMapDesc(`bg/ffxiv/wil_w1/rad/w1r1`, "Thanalan - Cutter's Cry"),
    new FFXIVMapDesc(`bg/ffxiv/roc_r1/fld/r1f1`, "Coerthas - Coerthas Central Highlands"),
    new FFXIVMapDesc(`bg/ffxiv/fst_f1/dun/f1d2`, "The Black Shroud - Haukke Manor"),
    new FFXIVMapDesc(`bg/ffxiv/fst_f1/dun/f1d2`, "The Black Shroud - Haukke Manor"),
    new FFXIVMapDesc(`bg/ffxiv/wil_w1/dun/w1d5`, "Thanalan - The Praetorium"),
    new FFXIVMapDesc(`bg/ffxiv/sea_s1/bah/s1b1`, "La Noscea - Upper Aetheroacoustic Exploratory Site"),
    new FFXIVMapDesc(`bg/ffxiv/sea_s1/bah/s1b2`, "La Noscea - Lower Aetheroacoustic Exploratory Site"),
    new FFXIVMapDesc(`bg/ffxiv/sea_s1/bah/s1b4`, "La Noscea - Ragnarok Drive Cylinder"),
    new FFXIVMapDesc(`bg/ffxiv/sea_s1/bah/s1b5`, "La Noscea - Ragnarok Central Core"),
    new FFXIVMapDesc(`bg/ffxiv/sea_s1/bah/s1b7`, "La Noscea - Ragnarok Main Bridge"),
    new FFXIVMapDesc(`bg/ffxiv/sea_s1/bah/s1b3`, "La Noscea - The Ragnarok"),
    new FFXIVMapDesc(`bg/ffxiv/sea_s1/bah/s1b3`, "La Noscea - The Ragnarok"),
    new FFXIVMapDesc(`bg/ffxiv/sea_s1/bah/s1b3`, "La Noscea - The Ragnarok"),
    new FFXIVMapDesc(`bg/ffxiv/fst_f1/bah/f1b3`, "The Black Shroud - Central Decks"),
    new FFXIVMapDesc(`bg/ffxiv/fst_f1/bah/f1b3`, "The Black Shroud - Central Decks"),
    new FFXIVMapDesc(`bg/ffxiv/fst_f1/bah/f1b3`, "The Black Shroud - Central Decks"),
    new FFXIVMapDesc(`bg/ffxiv/fst_f1/evt/f1e4`, "The Black Shroud - Seat of the First Bow"),
    new FFXIVMapDesc(`bg/ffxiv/fst_f1/evt/f1e5`, "The Black Shroud - Lotus Stand"),
    new FFXIVMapDesc(`bg/ffxiv/wil_w1/twn/w1t1`, "Thanalan - Ul'dah - Steps of Nald"),
    new FFXIVMapDesc(`bg/ffxiv/lak_l1/rad/l1r1`, "Mor Dhona - Labyrinth of the Ancients"),
    new FFXIVMapDesc(`bg/ffxiv/sea_s1/hou/s1h1`, "La Noscea - Mist"),
    new FFXIVMapDesc(`bg/ffxiv/wil_w1/twn/w1t2`, "Thanalan - Ul'dah - Steps of Thal"),
    new FFXIVMapDesc(`bg/ffxiv/sea_s1/twn/s1t1`, "La Noscea - Limsa Lominsa Upper Decks"),
    new FFXIVMapDesc(`bg/ffxiv/sea_s1/evt/s1e4`, "La Noscea - Command Room"),
    new FFXIVMapDesc(`bg/ffxiv/wil_w1/fld/w1fd`, "??? - The Memory of Embers"),
    new FFXIVMapDesc(`bg/ex3/01_nvt_n4/goe/n4gw`, "Norvrandt - A Future Rewritten"),
    new FFXIVMapDesc(`bg/ffxiv/wil_w1/evt/w1e4`, "Thanalan - Heart of the Sworn"),
    new FFXIVMapDesc(`bg/ffxiv/wil_w1/evt/w1e6`, "Thanalan - The Waking Sands"),
    new FFXIVMapDesc(`bg/ffxiv/fst_f1/hou/f1h1`, "The Black Shroud - The Lavender Beds"),
    new FFXIVMapDesc(`bg/ffxiv/wil_w1/hou/w1h1`, "Thanalan - The Goblet"),
    new FFXIVMapDesc(`bg/ffxiv/fst_f1/dun/f1d3`, "The Black Shroud - Amdapor Keep"),
    new FFXIVMapDesc(`bg/ffxiv/fst_f1/dun/f1d3`, "The Black Shroud - Amdapor Keep"),
    new FFXIVMapDesc(`bg/ffxiv/roc_r1/rad/r1r1`, "Coerthas - Dzemael Darkhold"),
    new FFXIVMapDesc(`bg/ffxiv/wil_w1/fld/w1f4`, "Thanalan - Southern Thanalan"),
    new FFXIVMapDesc(`bg/ffxiv/wil_w1/evt/w1e6`, "Thanalan - The Waking Sands"),
    new FFXIVMapDesc(`bg/ffxiv/wil_w1/rad/w1r1`, "Thanalan - Cutter's Cry"),
    new FFXIVMapDesc(`bg/ffxiv/wil_w1/rad/w1r1`, "Thanalan - Cutter's Cry"),
    new FFXIVMapDesc(`bg/ffxiv/roc_r1/fld/r1fa`, "Coerthas - The Howling Eye"),
    new FFXIVMapDesc(`bg/ffxiv/wil_w1/dun/w1d5`, "Thanalan - The Praetorium"),
];

const id = `FinalFantasyXIV`;
const name = "Final Fantasy XIV";

export const sceneGroup: SceneGroup = {
    id, name, sceneDescs,
};