import { useAtomValue } from "@effect/atom-react";
import {
  createEnvironmentPresentationAtoms,
  createEnvironmentPresentationAtomSelector,
} from "@t3tools/client-runtime/state/presentation";
import type { EnvironmentId } from "@t3tools/contracts";

import { environmentCatalog } from "../connection/catalog";
import { serverEnvironment } from "./server";

export const environmentPresentations = createEnvironmentPresentationAtoms({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  stateAtom: environmentCatalog.stateAtom,
  serverConfigValueAtom: serverEnvironment.configValueAtom,
});

const presentationAtomFor = createEnvironmentPresentationAtomSelector({
  presentationAtom: environmentPresentations.presentationAtom,
  platform: "web",
});

export function useEnvironmentPresentation(environmentId: EnvironmentId | null) {
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  const presentation = useAtomValue(presentationAtomFor(environmentId));
  return {
    isReady: catalog.isReady,
    presentation,
  };
}
