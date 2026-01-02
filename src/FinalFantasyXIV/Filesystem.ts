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

    static async load(dataFetcher: DataFetcher, levelId: string): Promise<FFXIVFilesystem> {
        const fs = new FFXIVFilesystem();
        const mapBase = `${levelId}`;
        console.time("Load terrain");
        const tera = fs.terrain = await fs.loadTerrainFile(dataFetcher, mapBase);
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
        const lgb = await Promise.all(lgbNames.map(lgb => fs.loadLgb(dataFetcher, `${mapBase}/level/${lgb}`)));
        const modelPathssInLgb = [...new Set(lgb.flatMap(l => l.discoveredModels))];
        console.log("Discovered", modelPathssInLgb.length, "model files in lgbs");
        const modelsInLgb = await Promise.all([...modelPathssInLgb.values()].map(model => fs.loadPart(dataFetcher, model)));
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
            const sgb = await Promise.all([...sgbFiles].map(sgb => fs.loadSgb(dataFetcher, sgb)));
            const modelPathsInSgb = [...new Set(sgb.flatMap(l => l?.discoveredModels ?? []))];
            console.log("Discovered", modelPathsInSgb.length, "model files in sgbs");
            const modelsInSgb = await Promise.all([...modelPathsInSgb.values()].map(model => fs.loadPart(dataFetcher, model)));
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
        const materials = await Promise.all([...materialNames.values()].map(mat => fs.loadMaterial(dataFetcher, mat)));
        console.timeEnd("Load materials");

        // discover textures
        console.time("Load textures");
        const textureNames = new Set<string>(materials.flatMap(m => m.texture_names));
        const textures = await Promise.all([...textureNames.values()].map(t => fs.loadTexture(dataFetcher, t)));
        console.timeEnd("Load textures");

        return fs;
    }

    private async loadLgb(dataFetcher: DataFetcher, path: string): Promise<FFXIVLgb> {
        const data = await dataFetcher.fetchData(`${pathBase}/${path}`);
        const lgb = shimLgb(FFXIVLgb.parse(new Uint8Array(data.arrayBuffer)));
        this.lgbs.set(path, lgb);
        return lgb;
    }

    private async loadSgb(dataFetcher: DataFetcher, path: string): Promise<FFXIVSgb | null> {
        const data = await dataFetcher.fetchData(`${pathBase}/${path}`);
        try {
            const sgb = shimSgb(FFXIVSgb.parse(new Uint8Array(data.arrayBuffer)));
            this.sgbs.set(path, sgb);
            return sgb;
        } catch {
            console.log(`Failed to load sgb ${path}`)
            return null;
        }
    }

    private async loadTerrainFile(dataFetcher: DataFetcher, mapBase: string): Promise<Terrain> {
        const path = `${mapBase}/bgplate/terrain.tera`;
        const terrain = new Terrain(await dataFetcher.fetchData(`${pathBase}/${path}`));

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
        const exists = this.models.get(path)
        if (exists) return exists;
        const data = await dataFetcher.fetchData(`${pathBase}/${path}`, {allow404: true});
        const model = FFXIVSceneManager.parse_mdl(new Uint8Array(data.arrayBuffer));
        if (!model) return null;
        this.models.set(path, model);
        return model;
    }

    private async loadMaterial(dataFetcher: DataFetcher, path: string): Promise<FFXIVMaterial> {
        const data = await dataFetcher.fetchData(`${pathBase}/${path}`);
        const realMat = FFXIVMaterial.parse(new Uint8Array(data.arrayBuffer));
        // i'm paranoid about getter_with_clone now
        const shimMat = {
            texture_names: realMat.texture_names,
            shader_name: realMat.shader_name,
        } as FFXIVMaterial;
        this.materials.set(path, shimMat);
        return shimMat;
    }

    private async loadTexture(dataFetcher: DataFetcher, path: string): Promise<Texture> {
        const data = await dataFetcher.fetchData(`${pathBase}/${path}`);
        const texture = new Texture(data, path);
        this.textures.set(path, texture);
        return texture;
    }
}