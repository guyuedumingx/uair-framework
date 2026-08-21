import type {
  InstallablePackageRecord,
  PackageCatalog
} from "./capability-resolver.js";

export class StaticPackageCatalog
  implements PackageCatalog {
  constructor(
    private readonly records:
      InstallablePackageRecord[]
  ) {}

  async search(
    query: string
  ) {
    const tokens =
      query
        .toLowerCase()
        .split(
          /[^a-z0-9_.-]+/
        )
        .filter(Boolean);

    return this.records.filter(
      record => {
        const text =
          [
            record.packageName,
            record.description ??
              "",
            ...record.capabilities
              .flatMap(
                capability => [
                  capability.id,
                  capability
                    .description ??
                    "",
                  ...(
                    capability.tags ??
                    []
                  )
                ]
              )
          ]
            .join(" ")
            .toLowerCase();

        return tokens.some(
          token =>
            text.includes(
              token
            )
        );
      }
    );
  }
}
