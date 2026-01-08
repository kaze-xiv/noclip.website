import { SceneGraph, SceneNode, SceneNodeData, walkScene } from "./scene";
import { SgbFile } from "./sgb";
import { AnimationController } from "../../rust/pkg";
import { FlatLayoutObject } from "./FlatLayoutObject";

export class Animator {
    public animate(scene: SceneGraph, timeMs: number) {
        for (let child of walkScene(scene)) {
            const animationController = child.animationController;
            if (!animationController) continue;
            this.animateNode(child, timeMs, child.data as SgbFile, animationController);
        }
    }

    public animateNode(node: SceneNode, timeMs: number, sgb: SgbFile, animationController: AnimationController) {
        for (let child of walkScene(node)) {
            const data = child.data as FlatLayoutObject;
            const instance_id = data?.instance_id;
            if (!instance_id) continue;
            animationController.animate(sgb.inner, instance_id, timeMs / 100, node.model_matrix);
        }

    }
}
