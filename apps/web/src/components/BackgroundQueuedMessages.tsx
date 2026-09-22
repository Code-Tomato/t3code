import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useComposerDraftStore } from "../composerDraftStore";
import { useShallow } from "zustand/react/shallow";
import { parseScopedThreadKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useParams } from "@tanstack/react-router";
import { resolveThreadRouteTarget } from "../threadRoutes";
import { derivePendingRequests } from "@t3tools/client-runtime/pending-requests";
import {
  useQueuedMessageStore,
  useQueuedMessages,
  isQueuedMessageDue,
  latestCompletedToolActivityId,
} from "../queuedMessageStore";
import { useThread, useServerConfigs } from "../state/entities";
import { useEnvironmentThread } from "../state/threads";
import { useEnvironments } from "../state/environments";
import { useClientSettingsHydrated } from "../hooks/useSettings";
import { derivePhase } from "../session-logic";
import { sendBackgroundQueuedMessage } from "../lib/sendBackgroundQueuedMessage";

export function BackgroundQueueCoordinator() {
  const target = useParams({ strict: false, select: resolveThreadRouteTarget });
  return (
    <BackgroundQueuedMessages
      activeThreadKey={target?.kind === "server" ? scopedThreadKey(target.threadRef) : null}
    />
  );
}

/** Subscribe only to threads with queued work, independently of the selected route. */
export function BackgroundQueuedMessages({ activeThreadKey }: { activeThreadKey: string | null }) {
  const keys = useQueuedMessageStore(useShallow((state) => Object.keys(state.queuesByThreadKey)));
  return keys.map((threadKey) => (
    <BackgroundThreadQueue
      key={threadKey}
      threadKey={threadKey}
      active={activeThreadKey === threadKey}
    />
  ));
}

function BackgroundThreadQueue({ threadKey, active }: { threadKey: string; active: boolean }) {
  const ref = useMemo(() => parseScopedThreadKey(threadKey), [threadKey]);
  const thread = useThread(ref);
  const detail = useEnvironmentThread(ref?.environmentId ?? null, ref?.threadId ?? null);
  const { environments } = useEnvironments();
  const configs = useServerConfigs();
  const hydrated = useClientSettingsHydrated();
  const message = useQueuedMessages(threadKey)[0];
  const rewinding = useComposerDraftStore((state) => state.rewindingThreadKeys.has(threadKey));
  const config = ref ? configs.get(ref.environmentId) : undefined;
  const phase = derivePhase(thread?.session ?? null);
  const latestToolActivityId = latestCompletedToolActivityId(thread?.activities ?? []);
  const pending = derivePendingRequests(thread?.activities ?? []);
  const connected = environments.some(
    (environment) =>
      environment.environmentId === ref?.environmentId &&
      environment.connection.phase === "connected",
  );
  const blocked =
    active ||
    rewinding ||
    !connected ||
    !hydrated ||
    !thread ||
    detail.status !== "live" ||
    pending.approvals.length > 0 ||
    pending.userInputs.length > 0;
  const busy = useRef(false);
  const [completedAttempt, setCompletedAttempt] = useState<object | null>(null);
  const lastSentBoundary = useRef<string | null>(null);
  const boundary = JSON.stringify([phase, latestToolActivityId, thread?.latestTurn?.turnId]);
  const live = useRef({ blocked, phase, latestToolActivityId, message, config, boundary });
  const mounted = useRef(false);
  useLayoutEffect(() => {
    live.current = { blocked, phase, latestToolActivityId, message, config, boundary };
  }, [blocked, phase, latestToolActivityId, message, config, boundary]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (lastSentBoundary.current !== boundary) lastSentBoundary.current = null;
    if (
      !ref ||
      !config ||
      !message?.sendOptions ||
      blocked ||
      busy.current ||
      completedAttempt === live.current ||
      lastSentBoundary.current === boundary
    )
      return;
    const canSend = () => {
      const current = live.current;
      return (
        mounted.current &&
        !current.blocked &&
        isQueuedMessageDue({
          message,
          phase: current.phase,
          latestToolActivityId: current.latestToolActivityId,
        })
      );
    };
    if (!canSend()) return;
    busy.current = true;
    const attempt = live.current;
    void sendBackgroundQueuedMessage(
      ref,
      message,
      message.sendOptions,
      canSend,
      () => live.current.latestToolActivityId,
    )
      .then((sent) => {
        if (sent) lastSentBoundary.current = boundary;
      })
      .finally(() => {
        busy.current = false;
        if (mounted.current) setCompletedAttempt(attempt);
      });
  }, [ref, message, blocked, boundary, config, completedAttempt]);
  return null;
}
