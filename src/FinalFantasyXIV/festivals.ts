import * as UI from "../ui";
import { ScrollSelectItemType } from "../ui";

export class FestivalPanel extends UI.Panel {
    constructor() {
        super();
        this.setTitle(UI.LAYER_ICON, "Festivals")
        const x = new UI.SingleSelect();
        // const festivalIdsPresent = [...this.globals.festivals].sort((a, b) => a - b);
        // const items = festivalIdsPresent.map((id) => festivals[id] ?? `Unknown festival ${id}`);
        // x.setItems(items.map(x => ({type: ScrollSelectItemType.Selectable, name: `${x}`})));
        // x.onselectionchange = (index: number) => {
        //     const festivalId = festivalIdsPresent[index];
        //     // this.globals.filesystem.loadFestival([...this.globals.filesystem.lgbs.values()], festivalId).then(() => {
        //     //     const filesystem = this.globals.filesystem;
        //     //     const globals = this.globals;
        //     //
        //     //     processTextures(this.globals.renderHelper.device, this.globals.filesystem);
        //     //
        //     //     for (const [materialPath, material] of filesystem.materials.entries()) {
        //     //         const textureName = material?.texture_names[0];
        //     //         const texture = globals.filesystem.textures.get(textureName);
        //     //         const alpha = (texture == undefined || texture.gfxTexture == null) ? 0.9 : 0.0
        //     //
        //     //         randomColorMap[materialPath] = colorNewFromRGBA(Math.random(), Math.random(), Math.random(), alpha);
        //     //     }
        //     //
        //     //     console.time("Create model renderers")
        //     //     const modelEntries = filesystem.models.entries();
        //     //     for (const [path, model] of modelEntries) {
        //     //         if (globals.modelCache[path]) continue;
        //     //         globals.modelCache[path] = new ModelRenderer(globals, model);
        //     //     }
        //     //     console.timeEnd("Create model renderers")
        //     //
        //     //     // const objects = [...this.globals.filesystem.lgbs.values()].flatMap(x => x.objects).filter(x => x.festival_id == festivalId);
        //     //     // this.festivalRenderer = new LayoutObjectsRenderer(this.globals, objects);
        //     //     console.log("Loaded festival", festivalId);
        //     // });
        // }
        this.contents.appendChild(x.elem);

    }
}

export const festivals: { [ids: number]: string | undefined } = {
    50: "bg_newyear2018_00",
    51: "bg_china2018_00",
    52: "bg_korea2018_00",
    58: "bg_halloween2017_00",
    61: "bg_newyear2019_00",
    62: "bg_china2019_00",
    63: "bg_korea2019_00",
    64: "bg_valentine2018_00",
    65: "bg_princess2018_00",
    66: "bg_easter2018_00",
    70: "bg_goldsaucer2018_00",
    71: "bg_summer2018_00",
    72: "bg_anniversary2018_00",
    76: "bg_halloween2018_00",
    77: "bg_christmas2018_00",
    79: "bg_newyear2020_00",
    80: "bg_china2020_00",
    81: "bg_korea2020_00",
    82: "bg_valentine2019_00",
    83: "bg_princess2019_00",
    85: "bg_easter2019_00",
    86: "bg_goldsaucer2019_00",
    89: "bg_summer2019_00",
    90: "bg_anniversary2019_00",
    91: "bg_halloween2019_00",
    95: "bg_christmas2019_00",
    97: "bg_newyear2021_00",
    98: "bg_china2021_00",
    99: "bg_korea2021_00",
    100: "bg_valentine2020_00,bg_valentine2020_01,bg_valentine2020_02,bg_valentine2020_03,bg_valentine2020_04,bg_valentine2020_05",
    103: "bg_princess2020_00",
    104: "bg_easter2020_00",
    105: "bg_goldsaucer2020_00",
    106: "bg_summer2020_00",
    107: "bg_anniversary2020_00",
    108: "bg_christmas2020_00",
    110: "bg_newyear2022_00",
    111: "bg_china2022_00",
    112: "bg_korea2022_00",
    113: "bg_val_pri2021_00",
    114: "bg_easter2021_00",
    115: "bg_goldsaucer2021_00",
    116: "bg_summer2021_00",
    117: "bg_anniversary2021_00",
    118: "bg_halloween2021_00",
    121: "bg_christmas2021_00",
    122: "bg_valentine2022_00",
    123: "bg_princess2022_00",
    124: "bg_easter2022_00",
    125: "bg_goldsaucer2022_00",
    126: "bg_summer2022_00",
    127: "bg_anniversary2022_00",
    129: "bg_newyear2023_00",
    130: "bg_china2023_00",
    131: "bg_korea2023_00",
    132: "bg_halloween2022_00",
    133: "bg_christmas2022_00",
    134: "bg_china2024_00,bg_korea2024_00,bg_newyear2024_00",
    135: "bg_valentine2023_00",
    136: "bg_easter2023_00",
    138: "bg_princess2023_00",
    139: "bg_goldsaucer2023_00",
    140: "bg_summer2023_00",
    141: "bg_anniversary2023_00",
    142: "bg_halloween2023_00",
    143: "bg_christmas2023_00",
    144: "bg_valentine2024_00",
    145: "bg_pri_eas2024_01,bg_pri_eas2024_02",
    146: "bg_goldsaucer2024_00",
    149: "bg_china2025_00,bg_korea2025_00,bg_newyear2025_00",
    150: "bg_summer2024_00",
    151: "bg_anniversary2024_00",
    152: "bg_halloween2024_00",
    153: "bg_christmas2024_00",
    154: "bg_valentine2025_00",
    155: "bg_princess2025_00",
    156: "bg_easter2025_00",
    157: "bg_china2026_00,bg_korea2026_00,bg_newyear2026_00",
    159: "bg_summer2025_00",
    161: "bg_goldsaucer2025_00",
    162: "bg_anniversary2025_00",
    163: "bg_valentine2026_00",
    164: "bg_halloween2025_00",
    165: "bg_christmas2025_00",
    167: "bg_china2027_00,bg_korea2027_00,bg_newyear2027_00",
    169: "bg_princess2026_00",
    172: "bg_easter2026_00",
    173: "bg_goldsaucer2026_00",
    174: "bg_summer2026_00",
    175: "bg_anniversary2026_00",
}