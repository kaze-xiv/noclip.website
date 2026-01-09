import { SceneGraph, SceneNode, walkScene } from "./scenegraph";
import { SgbFile } from "./files/layer";
import { AnimationController } from "../../rust/pkg";
import { FlatLayoutObject } from "./files/FlatLayoutObject";

export class Animator {
    public animate(scene: SceneGraph, timeMs: number) {
        for (let child of walkScene(scene)) {
            const animationController = child.animationController;
            if (!animationController) continue;
            this.animateNode(child, timeMs, child.data as SgbFile, animationController);
        }
    }

    public animateNode(node: SceneNode, timeMs: number, sgb: SgbFile, animationController: AnimationController) {
        const children = node.children![0].children ?? []; // terrible hack for layers, which are not supposed to be in the scene graph lol
        for (let child of children) { // can an sgb look into other sgbs?
            const data = child.data as FlatLayoutObject;
            const instance_id = data?.instance_id;
            if (!instance_id) continue;
            const result = animationController.animate(sgb.inner, instance_id, timeMs / 100, child.model_matrix);
            if (result) {
                // console.log(node.name, "animated instance ", instance_id);
            }
        }
    }
}
