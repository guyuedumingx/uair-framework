import {
  component
} from "@uair/core";
import type {
  CapabilitySet
} from "@uair/capability";

export type Principal = {
  id: string;
  roles: string[];
};

export type PermissionRule = {
  role: string;
  allow:
    string[];
};

export class PermissionDeniedError
  extends Error {
  constructor(
    readonly principalId:
      string,
    readonly permission:
      string
  ) {
    super(
      `Principal "${principalId}" lacks permission "${permission}"`
    );

    this.name =
      "PermissionDeniedError";
  }
}

export function createRbac(
  rules:
    PermissionRule[]
) {
  const allowed =
    new Map<
      string,
      Set<string>
    >();

  for (
    const rule of rules
  ) {
    let set =
      allowed.get(
        rule.role
      );

    if (!set) {
      set =
        new Set();

      allowed.set(
        rule.role,
        set
      );
    }

    for (
      const permission
      of rule.allow
    ) {
      set.add(
        permission
      );
    }
  }

  function can(
    principal: Principal,
    permission: string
  ) {
    return principal.roles.some(
      role =>
        allowed
          .get(role)
          ?.has(
            permission
          ) === true
    );
  }

  const requirePermission =
    component<
      {
        principal:
          Principal;
        permission:
          string;
      },
      true
    >(
      "rbac.requirePermission",
      async input => {
        if (
          !can(
            input.principal,
            input.permission
          )
        ) {
          throw new PermissionDeniedError(
            input.principal.id,
            input.permission
          );
        }

        return true as const;
      }
    );

  function filterCapabilities(
    principal: Principal,
    capabilities:
      CapabilitySet
  ) {
    return capabilities.filter(
      capability => {
        const permission =
          capability.metadata
            ?.permission;

        if (
          typeof permission !==
            "string"
        ) {
          return true as const;
        }

        return can(
          principal,
          permission
        );
      }
    );
  }

  return {
    can,
    requirePermission,
    filterCapabilities
  };
}
