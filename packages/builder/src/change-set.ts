import type {
  ChangeSet,
  ChangeSetItem,
  ChangeSafetyReport,
  ProjectGraph,
  ProjectGraphNode
} from "./types.js";

function sameNode(
  before:
    ProjectGraphNode,
  after:
    ProjectGraphNode
) {
  return (
    before.kind ===
      after.kind &&
    before.id ===
      after.id &&
    before.version ===
      after.version &&
    before.packageName ===
      after.packageName &&
    before.file ===
      after.file &&
    before.fingerprint ===
      after.fingerprint
  );
}

function affectedBy(
  graph:
    ProjectGraph,
  targetKey:
    string
) {
  const affected =
    new Map<
      string,
      {
        kind:
          ProjectGraphNode["kind"];
        id: string;
        via:
          "contains" |
          "imports" |
          "uses";
      }
    >();

  const queue =
    [targetKey];

  const visited =
    new Set<
      string
    >(
      queue
    );

  while (
    queue.length
  ) {
    const current =
      queue.shift()!;

    for (
      const edge
      of graph.edges
    ) {
      /**
       * Reverse traversal:
       * if A uses/imports/contains B, changing B can affect A.
       */
      if (
        edge.to !==
          current
      ) {
        continue;
      }

      const source =
        graph.nodes
          .find(
            item =>
              item.key ===
              edge.from
          );

      if (!source) {
        continue;
      }

      if (
        !affected.has(
          source.key
        )
      ) {
        affected.set(
          source.key,
          {
            kind:
              source.kind,
            id:
              source.id,
            via:
              edge.kind
          }
        );
      }

      if (
        !visited.has(
          source.key
        )
      ) {
        visited.add(
          source.key
        );

        queue.push(
          source.key
        );
      }
    }
  }

  return [
    ...affected.values()
  ];
}

export function createChangeSet(
  before:
    ProjectGraph,
  after:
    ProjectGraph
): ChangeSet {
  const beforeByKey =
    new Map(
      before.nodes.map(
        node => [
          node.key,
          node
        ]
      )
    );

  const afterByKey =
    new Map(
      after.nodes.map(
        node => [
          node.key,
          node
        ]
      )
    );

  const items:
    ChangeSetItem[] = [];

  for (
    const [
      key,
      oldNode
    ]
    of beforeByKey
  ) {
    const nextNode =
      afterByKey.get(
        key
      );

    if (!nextNode) {
      items.push({
        change:
          "remove",
        kind:
          oldNode.kind,
        id:
          oldNode.id,
        before:
          oldNode,
        affected:
          affectedBy(
            before,
            key
          )
      });

      continue;
    }

    if (
      !sameNode(
        oldNode,
        nextNode
      )
    ) {
      items.push({
        change:
          "modify",
        kind:
          oldNode.kind,
        id:
          oldNode.id,
        before:
          oldNode,
        after:
          nextNode,
        affected:
          affectedBy(
            before,
            key
          )
      });
    }
  }

  for (
    const [
      key,
      nextNode
    ]
    of afterByKey
  ) {
    if (
      beforeByKey.has(
        key
      )
    ) {
      continue;
    }

    items.push({
      change:
        "add",
      kind:
        nextNode.kind,
      id:
        nextNode.id,
      after:
        nextNode,
      affected: []
    });
  }

  const affectedNodes =
    new Set(
      items.flatMap(
        item =>
          item.affected
            .map(
              affected =>
                `${affected.kind}:${affected.id}`
            )
      )
    );

  return {
    items,
    summary: {
      added:
        items.filter(
          item =>
            item.change ===
            "add"
        ).length,
      modified:
        items.filter(
          item =>
            item.change ===
            "modify"
        ).length,
      removed:
        items.filter(
          item =>
            item.change ===
            "remove"
        ).length,
      affectedNodes:
        affectedNodes.size
    }
  };
}


export function analyzeChangeSetSafety(
  changeSet:
    ChangeSet
): ChangeSafetyReport {
  const issues:
    ChangeSafetyReport["issues"] =
    [];

  for (
    const item
    of changeSet.items
  ) {
    if (
      item.kind ===
        "workflow" &&
      item.change ===
        "modify" &&
      item.before &&
      item.after
    ) {
      if (
        (
          item.before.version ??
          "1"
        ) ===
        (
          item.after.version ??
          "1"
        )
      ) {
        issues.push({
          severity:
            "error",
          code:
            "WORKFLOW_IMPLEMENTATION_CHANGED_WITHOUT_VERSION_BUMP",
          message:
            `Workflow ${item.id} changed implementation without advancing durable version ${item.before.version ?? "1"}.`,
          kind:
            item.kind,
          id:
            item.id
        });
      } else {
        issues.push({
          severity:
            "info",
          code:
            "WORKFLOW_VERSION_ADVANCED",
          message:
            `Workflow ${item.id} advances ${item.before.version ?? "1"} → ${item.after.version ?? "1"}.`,
          kind:
            item.kind,
          id:
            item.id
        });
      }
    }

    if (
      item.change ===
        "remove" &&
      item.affected.length > 0
    ) {
      issues.push({
        severity:
          "error",
        code:
          "REMOVAL_HAS_DEPENDENTS",
        message:
          `${item.kind} ${item.id} is removed but still has ${item.affected.length} dependent node(s) in the current graph.`,
        kind:
          item.kind,
        id:
          item.id
      });
    }
  }

  return {
    safe:
      !issues.some(
        issue =>
          issue.severity ===
          "error"
      ),
    issues
  };
}
