import type {
  ContractCompatibilityIssue,
  ContractCompatibilityReport,
  ContractShape,
  ProjectGraph
} from "./types.js";

function shapeLabel(
  shape:
    ContractShape
): string {
  switch (
    shape.kind
  ) {
    case "unknown":
      return "unknown";
    case "primitive":
      return shape.type;
    case "literal":
      return JSON.stringify(
        shape.value
      );
    case "array":
      return `Array<${shapeLabel(shape.element)}>`;
    case "union":
      return shape.options
        .map(shapeLabel)
        .join(" | ");
    case "object":
      return "object";
  }
}

function acceptsShape(
  expected:
    ContractShape,
  previous:
    ContractShape,
  path: string,
  issues: string[]
) {
  if (
    expected.kind ===
      "unknown" ||
    previous.kind ===
      "unknown"
  ) {
    return;
  }

  if (
    expected.kind ===
      "union"
  ) {
    const compatible =
      expected.options
        .some(
          option => {
            const local:
              string[] = [];

            acceptsShape(
              option,
              previous,
              path,
              local
            );

            return (
              local.length ===
              0
            );
          }
        );

    if (!compatible) {
      issues.push(
        `${path}: previous ${shapeLabel(previous)} is not accepted by new union ${shapeLabel(expected)}`
      );
    }

    return;
  }

  if (
    previous.kind ===
      "union"
  ) {
    for (
      const option
      of previous.options
    ) {
      acceptsShape(
        expected,
        option,
        path,
        issues
      );
    }

    return;
  }

  if (
    expected.kind ===
      "literal"
  ) {
    if (
      previous.kind !==
        "literal" ||
      expected.value !==
        previous.value
    ) {
      issues.push(
        `${path}: new contract narrows value to ${shapeLabel(expected)}`
      );
    }

    return;
  }

  if (
    expected.kind ===
      "primitive"
  ) {
    if (
      previous.kind ===
        "literal"
    ) {
      const type =
        previous.value ===
          null
          ? "null"
          : typeof previous.value;

      if (
        type !==
          expected.type
      ) {
        issues.push(
          `${path}: ${shapeLabel(previous)} is not compatible with ${expected.type}`
        );
      }

      return;
    }

    if (
      previous.kind !==
        "primitive" ||
      previous.type !==
        expected.type
    ) {
      issues.push(
        `${path}: type changed ${shapeLabel(previous)} → ${shapeLabel(expected)}`
      );
    }

    return;
  }

  if (
    expected.kind ===
      "array"
  ) {
    if (
      previous.kind !==
        "array"
    ) {
      issues.push(
        `${path}: expected array but previous contract was ${shapeLabel(previous)}`
      );

      return;
    }

    acceptsShape(
      expected.element,
      previous.element,
      `${path}[]`,
      issues
    );

    return;
  }

  if (
    expected.kind ===
      "object"
  ) {
    if (
      previous.kind !==
        "object"
    ) {
      issues.push(
        `${path}: expected object but previous contract was ${shapeLabel(previous)}`
      );

      return;
    }

    for (
      const [
        name,
        property
      ]
      of Object.entries(
        expected.properties
      )
    ) {
      const old =
        previous.properties[
          name
        ];

      if (!old) {
        if (
          property.required
        ) {
          issues.push(
            `${path}.${name}: new required field is not present in previous contract`
          );
        }

        continue;
      }

      acceptsShape(
        property.shape,
        old.shape,
        `${path}.${name}`,
        issues
      );
    }

    return;
  }

  issues.push(
    `${path}: incompatible contract ${shapeLabel(previous)} → ${shapeLabel(expected)}`
  );
}

/**
 * Output compatibility runs in the opposite structural direction:
 * consumers written against the old output must still find everything
 * they previously relied on in the new output.
 */
function outputCompatibility(
  previous:
    ContractShape,
  next:
    ContractShape,
  path: string,
  issues: string[]
) {
  acceptsShape(
    previous,
    next,
    path,
    issues
  );
}

function acceptsValue(
  shape:
    ContractShape,
  value: unknown,
  path: string,
  issues: string[]
) {
  if (
    shape.kind ===
      "unknown"
  ) {
    return;
  }

  if (
    shape.kind ===
      "union"
  ) {
    const compatible =
      shape.options
        .some(
          option => {
            const local:
              string[] = [];

            acceptsValue(
              option,
              value,
              path,
              local
            );

            return (
              local.length ===
              0
            );
          }
        );

    if (!compatible) {
      issues.push(
        `${path}: runtime value does not match any new union option`
      );
    }

    return;
  }

  if (
    shape.kind ===
      "literal"
  ) {
    if (
      value !==
        shape.value
    ) {
      issues.push(
        `${path}: expected literal ${JSON.stringify(shape.value)}`
      );
    }

    return;
  }

  if (
    shape.kind ===
      "primitive"
  ) {
    const actual =
      value === null
        ? "null"
        : typeof value;

    if (
      actual !==
        shape.type
    ) {
      issues.push(
        `${path}: expected ${shape.type}, received ${actual}`
      );
    }

    return;
  }

  if (
    shape.kind ===
      "array"
  ) {
    if (
      !Array.isArray(
        value
      )
    ) {
      issues.push(
        `${path}: expected array`
      );

      return;
    }

    value.forEach(
      (
        item,
        index
      ) =>
        acceptsValue(
          shape.element,
          item,
          `${path}[${index}]`,
          issues
        )
    );

    return;
  }

  if (
    shape.kind ===
      "object"
  ) {
    if (
      typeof value !==
        "object" ||
      value === null ||
      Array.isArray(
        value
      )
    ) {
      issues.push(
        `${path}: expected object`
      );

      return;
    }

    const record =
      value as
        Record<
          string,
          unknown
        >;

    for (
      const [
        name,
        property
      ]
      of Object.entries(
        shape.properties
      )
    ) {
      if (
        !(
          name in
          record
        )
      ) {
        if (
          property.required
        ) {
          issues.push(
            `${path}.${name}: required field missing from durable payload`
          );
        }

        continue;
      }

      acceptsValue(
        property.shape,
        record[name],
        `${path}.${name}`,
        issues
      );
    }
  }
}

export type RuntimeSurfaceSample = {
  kind: string;
  data: unknown;
};

export function analyzeContractCompatibility(
  before:
    ProjectGraph,
  after:
    ProjectGraph,
  runtimeSurfaceSamples:
    RuntimeSurfaceSample[] = []
): ContractCompatibilityReport {
  const issues:
    ContractCompatibilityIssue[] =
    [];

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

  for (
    const [
      key,
      previous
    ]
    of beforeByKey
  ) {
    const next =
      afterByKey.get(
        key
      );

    if (
      !next ||
      !previous.contract ||
      !next.contract
    ) {
      continue;
    }

    const inputIssues:
      string[] = [];

    if (
      previous.contract.input &&
      next.contract.input
    ) {
      acceptsShape(
        next.contract.input,
        previous.contract.input,
        "input",
        inputIssues
      );
    }

    for (
      const message
      of inputIssues
    ) {
      issues.push({
        severity:
          "error",
        code:
          "INPUT_CONTRACT_NARROWED",
        message,
        kind:
          previous.kind,
        id:
          previous.id,
        path:
          message.split(
            ":"
          )[0]
      });
    }

    const outputIssues:
      string[] = [];

    if (
      previous.contract.output &&
      next.contract.output
    ) {
      outputCompatibility(
        previous.contract.output,
        next.contract.output,
        "output",
        outputIssues
      );
    }

    for (
      const message
      of outputIssues
    ) {
      issues.push({
        severity:
          "error",
        code:
          "OUTPUT_CONTRACT_BROKEN",
        message,
        kind:
          previous.kind,
        id:
          previous.id,
        path:
          message.split(
            ":"
          )[0]
      });
    }

    const actionIssues:
      string[] = [];

    if (
      previous.contract.action &&
      next.contract.action
    ) {
      acceptsShape(
        next.contract.action,
        previous.contract.action,
        "action",
        actionIssues
      );
    }

    for (
      const message
      of actionIssues
    ) {
      issues.push({
        severity:
          "error",
        code:
          "SURFACE_ACTION_CONTRACT_NARROWED",
        message,
        kind:
          previous.kind,
        id:
          previous.id,
        path:
          message.split(
            ":"
          )[0]
      });
    }

    const dataIssues:
      string[] = [];

    if (
      previous.contract.data &&
      next.contract.data
    ) {
      acceptsShape(
        next.contract.data,
        previous.contract.data,
        "data",
        dataIssues
      );
    }

    for (
      const message
      of dataIssues
    ) {
      issues.push({
        severity:
          "error",
        code:
          "SURFACE_DATA_CONTRACT_NARROWED",
        message,
        kind:
          previous.kind,
        id:
          previous.id,
        path:
          message.split(
            ":"
          )[0]
      });
    }
  }

  const runtimePayloadChecks =
    [
      ...new Set(
        runtimeSurfaceSamples
          .map(
            sample =>
              sample.kind
          )
      )
    ]
      .map(
        kind => {
          const node =
            after.nodes.find(
              item =>
                item.kind ===
                  "surface" &&
                item.id ===
                  kind
            );

          const samples =
            runtimeSurfaceSamples
              .filter(
                sample =>
                  sample.kind ===
                  kind
              );

          const sampleIssues:
            string[] = [];

          if (
            node?.contract?.data
          ) {
            for (
              const [
                index,
                sample
              ]
              of samples.entries()
            ) {
              acceptsValue(
                node.contract.data,
                sample.data,
                `sample[${index}]`,
                sampleIssues
              );
            }
          }

          if (
            sampleIssues.length
          ) {
            issues.push({
              severity:
                "error",
              code:
                "PENDING_SURFACE_PAYLOAD_INCOMPATIBLE",
              message:
                `${kind}: ${sampleIssues.join("; ")}`,
              kind:
                "surface",
              id:
                kind
            });
          }

          return {
            surfaceKind:
              kind,
            samples:
              samples.length,
            compatible:
              sampleIssues.length ===
              0,
            issues:
              sampleIssues
          };
        }
      );

  return {
    compatible:
      !issues.some(
        issue =>
          issue.severity ===
          "error"
      ),
    issues,
    runtimePayloadChecks
  };
}
