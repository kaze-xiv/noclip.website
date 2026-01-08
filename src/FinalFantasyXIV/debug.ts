import * as UI from "../ui";
import { SceneGraph, SceneNode } from "./scene";
import { ScrollSelectItem, ScrollSelectItemType } from "../ui";
import { FlatLayoutObject } from "./FlatLayoutObject";
import { SgbFile } from "./sgb";

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
        const desc = instance_id ? `${instance_id}: ${node.name ?? "Unknown node"}` : (node.name ?? "Unknown node")
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