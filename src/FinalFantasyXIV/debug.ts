import * as UI from "../ui";
import { SceneGraph, SceneNode } from "./scenegraph";
import { ScrollSelectItem, ScrollSelectItemType } from "../ui";
import { FlatLayoutObject } from "./files/FlatLayoutObject";
import { SgbFile } from "./files/layer";

interface SceneNodeWithDepth {
    node: SceneNode,
    depth: number,
}

export class DebugSceneGraphPanel {

    public highlightedNode: SceneNode | null = null;

    private* walk(node: SceneNode, depth: number): Generator<SceneNodeWithDepth> {
        if (!(node.data as SgbFile)?.inner) {
            // skip
            yield {node, depth};
        }
        for (let i = 0; i < (node.children?.length ?? 0); i++) {
            for (let x of this.walk(node.children![i], depth + 1)) yield x;
        }
    }

    private createItem(nodeDepth: SceneNodeWithDepth): ScrollSelectItem {
        const {node, depth} = nodeDepth;

        const span = document.createElement("span");
        span.style = "overflow:hidden; white-space:nowrap";
        const prefix = "&nbsp;".repeat(depth);

        const instance_id = (node?.data as FlatLayoutObject)?.instance_id;
        const layer_type = (node?.data as FlatLayoutObject)?.object_type;
        let desc: string;
        if (instance_id) {
            if (node.name)
                desc = `${instance_id}: ${node.name}`;
            else
                desc = `${instance_id}: ${nodeTypeNames[layer_type ?? 0]}`;
        }
        else
            desc = (node.name ?? `Unknown node 0x${layer_type?.toString(16)}`)

        span.innerHTML = prefix + desc;
        return {
            type: ScrollSelectItemType.Selectable,
            visible: true,
            html: span,
        };
    }

    public createPanel(scene: SceneGraph): UI.Panel {
        const ret = new UI.Panel();
        ret.setTitle(UI.LAYER_ICON, "SceneGraph")
        const x = new UI.SingleSelect();
        const nodes = [...this.walk(scene, 0)];
        const items = nodes.map(x => this.createItem(x));
        x.setItems(items);
        x.onselectionchange = (index: number) => {
            this.highlightedNode = nodes[index].node;
        }
        ret.contents.appendChild(x.elem);
        return ret;
    }

}

const nodeTypeNames: {[key: number]: string} = {
    0x0: "None",
    0x1: "BG",
    0x2: "Attribute",
    0x3: "LayLight",
    0x4: "Vfx",
    0x5: "PositionMarker",
    0x6: "SharedGroup",
    0x7: "Sound",
    0x8: "EventNPC",
    0x9: "BattleNPC",
    0xA: "RoutePath",
    0xB: "Character",
    0xC: "Aetheryte",
    0xD: "EnvSet",
    0xE: "Gathering",
    0xF: "HelperObject",
    0x10: "Treasure",
    0x11: "Clip",
    0x12: "ClipCtrlPoint",
    0x13: "ClipCamera",
    0x14: "ClipLight",
    0x15: "ClipReserve00",
    0x16: "ClipReserve01",
    0x17: "ClipReserve02",
    0x18: "ClipReserve03",
    0x19: "ClipReserve04",
    0x1A: "ClipReserve05",
    0x1B: "ClipReserve06",
    0x1C: "ClipReserve07",
    0x1D: "ClipReserve08",
    0x1E: "ClipReserve09",
    0x1F: "ClipReserve10",
    0x20: "ClipReserve11",
    0x21: "ClipReserve12",
    0x22: "ClipReserve13",
    0x23: "ClipReserve14",
    0x24: "CutAssetOnlySelectable",
    0x25: "Player",
    0x26: "Monster",
    0x27: "Weapon",
    0x28: "PopRange",
    0x29: "ExitRange",
    0x2A: "Lvb",
    0x2B: "MapRange",
    0x2C: "NaviMeshRange",
    0x2D: "EventObject",
    0x2E: "DemiHuman",
    0x2F: "EnvLocation",
    0x30: "ControlPoint",
    0x31: "EventRange",
    0x32: "RestBonusRange",
    0x33: "QuestMarker",
    0x34: "Timeline",
    0x35: "ObjectBehaviorSet",
    0x36: "Movie",
    0x37: "ScenarioExd",
    0x38: "ScenarioText",
    0x39: "CollisionBox",
    0x3A: "DoorRange",
    0x3B: "LineVFX",
    0x3C: "SoundEnvSet",
    0x3D: "CutActionTimeline",
    0x3E: "CharaScene",
    0x3F: "CutAction",
    0x40: "EquipPreset",
    0x41: "ClientPath",
    0x42: "ServerPath",
    0x43: "GimmickRange",
    0x44: "TargetMarker",
    0x45: "ChairMarker",
    0x46: "ClickableRange",
    0x47: "PrefetchRange",
    0x48: "FateRange",
    0x49: "PartyMember",
    0x4A: "KeepRange",
    0x4B: "SphereCastRange",
    0x4C: "IndoorObject",
    0x4D: "OutdoorObject",
    0x4E: "EditGroup",
    0x4F: "StableChocobo",
    0x50: "MaxAssetType",
    90: "Unk1",
    83: "Unk4",
    86: "Unk2",
    87: "Unk5",
    89: "Unk3",
};
