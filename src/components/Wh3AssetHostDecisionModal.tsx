import React, { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "../flowbite/components/Modal/index";
import { useLocalizations } from "../localizationContext";
import type { Wh3AssetHostDecisionAction, Wh3AssetHostDecisionRequest } from "../wh3AssetHostClient";

const Wh3AssetHostDecisionModal = () => {
  const localized = useLocalizations();
  const [request, setRequest] = useState<Wh3AssetHostDecisionRequest | null>(null);
  const [isResponding, setIsResponding] = useState(false);
  const [responseError, setResponseError] = useState<string | null>(null);
  const requestRef = useRef<Wh3AssetHostDecisionRequest | null>(null);

  const respond = useCallback(
    async (action: Wh3AssetHostDecisionAction) => {
      const pendingRequest = requestRef.current;
      if (!pendingRequest || isResponding) return;

      setIsResponding(true);
      setResponseError(null);
      try {
        const result = await window.api?.respondWh3AssetHostDecision(pendingRequest.requestId, action);
        if (result?.success === false) {
          setResponseError(result.error || "The asset-host decision could not be sent.");
          return;
        }
        requestRef.current = null;
        setRequest(null);
      } catch (error) {
        setResponseError(error instanceof Error ? error.message : "The asset-host decision could not be sent.");
      } finally {
        setIsResponding(false);
      }
    },
    [isResponding],
  );

  useEffect(() => {
    const removeListener = window.api?.onWh3AssetHostDecisionRequest((_event, nextRequest) => {
      const previousRequest = requestRef.current;
      if (previousRequest && previousRequest.requestId !== nextRequest.requestId) {
        void window.api?.respondWh3AssetHostDecision(previousRequest.requestId, "cancelExport");
      }
      requestRef.current = nextRequest;
      setRequest(nextRequest);
      setResponseError(null);
      setIsResponding(false);
    });

    return () => {
      removeListener?.();
      const pendingRequest = requestRef.current;
      if (pendingRequest) {
        void window.api?.respondWh3AssetHostDecision(pendingRequest.requestId, "cancelExport");
        requestRef.current = null;
      }
    };
  }, []);

  const title = localized.wh3AssetHostMissingSkeletonTitle || "Skeleton data is missing";
  const continueLabel = localized.wh3AssetHostMissingSkeletonContinue || "Continue without skeleton";
  const message =
    localized.wh3AssetHostMissingSkeletonMessage ||
    "This model references a skeleton file that was not found. Continue exporting without a skeleton?";

  return (
    <Modal
      show={request !== null}
      onClose={() => void respond("cancelExport")}
      size="md"
      position="center"
      explicitClasses={["z-[110]"]}
    >
      <Modal.Header>{title}</Modal.Header>
      <Modal.Body>
        <div className="space-y-3 text-sm leading-relaxed text-gray-300">
          <p>{message}</p>
          <p>
            <span className="font-semibold text-gray-100">{request?.skeletonName}</span>
          </p>
          {request?.message && <p className="text-gray-400">{request.message}</p>}
          {responseError && <p className="text-red-300">{responseError}</p>}
        </div>
      </Modal.Body>
      <Modal.Footer>
        <button
          type="button"
          className="rounded-lg bg-gray-600 px-4 py-2 text-sm font-medium text-white hover:bg-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-400 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => void respond("cancelExport")}
          disabled={isResponding}
          data-testid="wh3-asset-host-cancel-skeleton"
        >
          {localized.cancel || "Cancel"}
        </button>
        <button
          type="button"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => void respond("continueWithoutSkeleton")}
          disabled={isResponding}
          data-testid="wh3-asset-host-continue-skeleton"
        >
          {continueLabel}
        </button>
      </Modal.Footer>
    </Modal>
  );
};

export default Wh3AssetHostDecisionModal;
