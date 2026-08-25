import {
  component
} from "@uair/core";

import type {
  Component
} from "@uair/core";

import {
  CapabilitySet,
  type Capability
} from "@uair/capability";

import type {
  Principal
} from "./rbac.js";

export type CapabilityAuthorizationInput = {
  principal:
    Principal;
  capability:
    Capability;
  permission?:
    string;
};

export type CapabilityAuthorizer =
  (
    input:
      CapabilityAuthorizationInput
  ) =>
    boolean |
    Promise<boolean>;

export class CapabilityPermissionDeniedError
  extends Error {
  constructor(
    readonly principalId:
      string,
    readonly capabilityId:
      string,
    readonly permission?:
      string
  ) {
    super(
      `Principal "${principalId}" may not invoke capability "${capabilityId}"` +
      (
        permission
          ? ` (permission "${permission}")`
          : ""
      )
    );

    this.name =
      "CapabilityPermissionDeniedError";
  }
}

export function capabilityPermission(
  capability:
    Capability
) {
  const value =
    capability.metadata
      ?.permission;

  return typeof value ===
    "string"
    ? value
    : undefined;
}

/**
 * Returns principal-bound capabilities.
 *
 * Discovery filtering alone is not a security boundary. Every returned
 * invoker also checks authorization immediately before execution.
 */
export function bindCapabilities(
  principal:
    Principal,
  capabilities:
    CapabilitySet,
  authorize:
    CapabilityAuthorizer
) {
  const result =
    new CapabilitySet();

  for (
    const capability
    of capabilities.list()
  ) {
    const permission =
      capabilityPermission(
        capability
      );

    const original =
      capability.invoke;

    if (!original) {
      result.add(
        capability
      );

      continue;
    }

    const guarded =
      component<
        Record<
          string,
          unknown
        > | undefined,
        unknown
      >(
        `security:${capability.id}`,
        async input => {
          const allowed =
            await authorize({
              principal,
              capability,
              permission
            });

          if (!allowed) {
            throw new CapabilityPermissionDeniedError(
              principal.id,
              capability.id,
              permission
            );
          }

          return original(
            input
          );
        }
      );

    result.add({
      ...capability,
      invoke:
        guarded as Component<
          Record<
            string,
            unknown
          > | undefined,
          unknown
        >
    });
  }

  return result;
}

export function rbacCapabilityAuthorizer(
  can:
    (
      principal:
        Principal,
      permission:
        string
    ) => boolean
): CapabilityAuthorizer {
  return ({
    principal,
    permission
  }) => {
    if (!permission) {
      return false;
    }

    return can(
      principal,
      permission
    );
  };
}
