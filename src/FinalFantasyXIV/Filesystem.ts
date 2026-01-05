import { FFXIVLgb, FFXIVMaterial, FFXIVModel, FFXIVSceneManager, FFXIVSgb } from "../../rust/pkg";
import { Terrain } from "./Terrain";
import { Texture } from "./Texture";
import { DataFetcher } from "../DataFetcher";
import { range } from "../MathHelpers";
import { shimLgb, shimSgb } from "./sgb";

const pathBase = "FFXIV";

export class FFXIVFilesystem {
    public terrain: Terrain;
    public models = new Map<string, FFXIVModel>();
    public textures = new Map<string, Texture>();
    public materials = new Map<string, FFXIVMaterial>();
    public lgbs = new Map<string, FFXIVLgb>();
    public sgbs = new Map<string, FFXIVSgb>();

    constructor(public dataFetcher: DataFetcher) {
    }

    static async load(dataFetcher: DataFetcher, levelId: string): Promise<FFXIVFilesystem> {
        const fs = new FFXIVFilesystem(dataFetcher);
        const mapBase = `${levelId}`;
        console.time("Load terrain");
        const tera = fs.terrain = await fs.loadTerrainFile(mapBase);
        console.timeEnd("Load terrain");

        const materialNames = new Set<string>();
        const materialsInTera = tera.models.flatMap(m => m?.meshes?.map(mesh => m.materials[mesh.get_material_index()]) ?? [])

        for (let i = 0; i < materialsInTera.length; i++)
            materialNames.add(materialsInTera[i]);

        console.time("Load materials");
        const materials = await Promise.all([...materialNames.values()].map(mat => fs.loadMaterial(mat)));
        console.timeEnd("Load materials");

        // discover textures
        console.time("Load textures");
        const textureNames = new Set<string>(materials.flatMap(m => m.texture_names));
        const textures = await Promise.all([...textureNames.values()].map(t => fs.loadTexture(t)));
        console.timeEnd("Load textures");

        console.time("Load LGB")
        const lgbNames = ["bg.lgb",
            "planmap.lgb",
            "planevent.lgb"
        ];
        const lgb = await Promise.all(lgbNames.map(lgb => fs.loadLgb(`${mapBase}/level/${lgb}`)));
        await fs.loadObjects(lgb);

        return fs;
    }

    async loadObjects(lgbs: FFXIVLgb[]) {
        await this.loadFestival(lgbs, 0)
    }

    * modelsInLgb(lgb: FFXIVLgb, festivalId: number = 0): IterableIterator<string> {
        if (festivalId == 0) {
            for (let i = 0; i < lgb.discoveredModels.length; i++)
                yield lgb.discoveredModels[i];
        } else {
            for (let i = 0; i < lgb.objects.length; i++) {
                const obj = lgb.objects[i];
                if (obj.layer_type == 0x01) yield obj.asset_name!;
            }
        }
    }

    * sgbsInLgb(lgb: FFXIVLgb, festivalId: number = 0): IterableIterator<string> {
        if (festivalId == 0) {
            for (let i = 0; i < lgb.discoveredSgbs.length; i++)
                yield lgb.discoveredSgbs[i];
        } else {
            for (let i = 0; i < lgb.objects.length; i++) {
                const obj = lgb.objects[i];
                if (obj.layer_type == 0x06) yield obj.asset_name!;
            }
        }
    }

    * modelsInSgb(lgb: FFXIVSgb, festivalId: number = 0): IterableIterator<string> {
        if (festivalId == 0) {
            for (let i = 0; i < lgb.discoveredModels.length; i++)
                yield lgb.discoveredModels[i];
        } else {
            for (let i = 0; i < lgb.objects.length; i++) {
                const obj = lgb.objects[i];
                if (obj.layer_type == 0x01) yield obj.asset_name!;
            }
        }
    }

    * sgbsInSgb(lgb: FFXIVSgb, festivalId: number = 0): IterableIterator<string> {
        if (festivalId == 0) {
            for (let i = 0; i < lgb.discoveredSgbs.length; i++)
                yield lgb.discoveredSgbs[i];
        } else {
            for (let i = 0; i < lgb.objects.length; i++) {
                const obj = lgb.objects[i];
                if (obj.layer_type == 0x06) yield obj.asset_name!;
            }
        }
    }

    public async loadFestival(lgbs: FFXIVLgb[], festivalId: number) {
        const materialNames = new Set<string>();

        const modelPathssInLgb = new Set<string>(lgbs.flatMap<string>(lgb => Array.from(this.modelsInLgb(lgb, festivalId))));
        console.log("Discovered", modelPathssInLgb.size, "model files in lgbs", festivalId);
        const modelsInLgb = await Promise.all([...modelPathssInLgb.values()].map(model => this.loadPart(model)));
        const materialsInModelsInLgb = modelsInLgb.flatMap(model => model?.meshes?.map(mesh => model.materials[mesh.get_material_index()]) ?? []);
        for (let i = 0; i < materialsInModelsInLgb.length; i++) {
            materialNames.add(materialsInModelsInLgb[i]);
        }
        console.timeEnd("Load LGB")

        console.time("Load SGB")
        const loadedSgbFiles = new Set<string>();
        let sgbFiles = new Set(lgbs.flatMap(l => Array.from(this.sgbsInLgb(l))));
        let foundMore = true;
        while (foundMore) {
            foundMore = false;
            console.log("Discovered", sgbFiles.size, "sgb files in lgbs");
            const sgbF = [...sgbFiles];
            for (let i = 0; i < sgbF.length; i++) {
                loadedSgbFiles.add(sgbF[i]);
            }
            const sgb = await Promise.all([...sgbFiles].map(sgb => this.loadSgb(sgb)));
            const modelPathsInSgb = [...new Set(sgb.flatMap(l => Array.from(this.modelsInSgb(l))))];
            console.log("Discovered", modelPathsInSgb.length, "model files in sgbs");
            const modelsInSgb = await Promise.all([...modelPathsInSgb.values()].map(model => this.loadPart(model)));
            const materialsInModelsInSgb = modelsInSgb.flatMap(model => model?.meshes?.map(mesh => model.materials[mesh.get_material_index()]) ?? []);
            for (let i = 0; i < materialsInModelsInSgb.length; i++) {
                materialNames.add(materialsInModelsInSgb[i]);
            }

            const moreSgb = new Set(sgb.flatMap(l => Array.from(this.sgbsInSgb(l))));
            const notDone = ((moreSgb as any).difference)(loadedSgbFiles) as Set<string>;
            if (notDone.size > 0) {
                sgbFiles = notDone;
                foundMore = true;
            }

        }
        console.timeEnd("Load SGB")

        console.time("Load materials");
        const materials = await Promise.all([...materialNames.values()].map(mat => this.loadMaterial(mat)));
        console.timeEnd("Load materials");

        // discover textures
        console.time("Load textures");
        const textureNames = new Set<string>(materials.flatMap(m => m.texture_names));
        const textures = await Promise.all([...textureNames.values()].map(t => this.loadTexture(t)));
        console.timeEnd("Load textures");
    }

    private async loadLgb(path: string): Promise<FFXIVLgb> {
        const data = await this.dataFetcher.fetchData(`${pathBase}/${path}`);
        const lgb = shimLgb(FFXIVLgb.parse(new Uint8Array(data.arrayBuffer)));
        this.lgbs.set(path, lgb);
        return lgb;
    }

    private async loadSgb(path: string): Promise<FFXIVSgb> {
        const attempt = this.sgbs.get(path);
        if (attempt) return attempt;
        const data = await this.dataFetcher.fetchData(`${pathBase}/${path}`);
        const sgb = shimSgb(FFXIVSgb.parse(new Uint8Array(data.arrayBuffer)));
        this.sgbs.set(path, sgb);
        return sgb;
    }

    private async loadTerrainFile(mapBase: string): Promise<Terrain> {
        const path = `${mapBase}/bgplate/terrain.tera`;

        const terrain = new Terrain(await this.dataFetcher.fetchData(`${pathBase}/${path}`));

        const files = range(0, terrain.plateCount);
        const partNames = files.map(i => {
            const fn = `${i}`.padStart(4, "0");
            return `${mapBase}/bgplate/${fn}.mdl`;
        });
        terrain.modelNames = partNames;

        const models = await Promise.all(partNames.map(p => this.loadPart(p)));
        terrain.models = models as FFXIVModel[]; // yuck

        return terrain;
    }

    private async loadPart(path: string): Promise<FFXIVModel | null> {
        const exists = this.models.get(path)
        if (exists) return exists;
        const data = await this.dataFetcher.fetchData(`${pathBase}/${path}`, {allow404: true});
        const model = FFXIVSceneManager.parse_mdl(new Uint8Array(data.arrayBuffer));
        if (!model) return null;
        this.models.set(path, model);
        return model;
    }

    private async loadMaterial(path: string): Promise<FFXIVMaterial> {
        const attempt = this.materials.get(path);
        if (attempt) return attempt;
        const data = await this.dataFetcher.fetchData(`${pathBase}/${path}`);
        const realMat = FFXIVMaterial.parse(new Uint8Array(data.arrayBuffer));
        // i'm paranoid about getter_with_clone now
        const shimMat = {
            texture_names: realMat.texture_names,
            shader_name: realMat.shader_name,
        } as FFXIVMaterial;
        this.materials.set(path, shimMat);
        return shimMat;
    }

    private async loadTexture(path: string): Promise<Texture> {
        const attempt = this.textures.get(path);
        if (attempt) return attempt;
        const data = await this.dataFetcher.fetchData(`${pathBase}/${path}`);
        const texture = new Texture(data, path);
        this.textures.set(path, texture);
        return texture;
    }
}

interface FestivalLoadResult {
    newModels: FFXIVModel[],
    newTextures: Texture[],
    newMaterials: FFXIVMaterial[],
}