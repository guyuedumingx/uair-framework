import {
  component,
  workflow
} from "@uair/core";

import {
  present,
  surface,
  type SurfaceAction
} from "@uair/ui";

export type UserAction =
  | {
      type: "message";
      text: string;
    }
  | {
      type: "select";
      id: string;
      label?: string;
    }
  | {
      type: "approve-capability";
      capabilityId: string;
      packageName: string;
    }
  | {
      type: "reject-capability";
      capabilityId: string;
      packageName: string;
    };

export type AmbientSurface = {
  kind: string;
  title: string;
  text: string;
  tone:
    | "info"
    | "success"
    | "warning";
};

export type AgentView =
  | {
      kind: "welcome";
      title: string;
      suggestions: string[];
    }
  | {
      kind: "message";
      title: string;
      text: string;
    }
  | {
      kind: "list";
      title: string;
      subtitle: string;
      items: Array<{
        id: string;
        title: string;
        meta: string;
        value: string;
      }>;
    }
  | {
      kind: "detail";
      title: string;
      fields: Array<{
        label: string;
        value: string;
      }>;
      actions: string[];
    }
  | {
      kind: "capability-proposal";
      title: string;
      capabilityId: string;
      packageName: string;
      packageVersion: string;
      resolution:
        | "install"
        | "generate";
      steps: Array<{
        label: string;
        status:
          | "done"
          | "ready"
          | "blocked";
      }>;
      note: string;
      requiresApproval: boolean;
    }
  | {
      kind: "capability-result";
      title: string;
      status:
        | "approved"
        | "rejected";
      capabilityId: string;
      packageName: string;
      text: string;
    };

const searchCustomers =
  component({
    id:
      "crm.customer.list",

    async run(input: {
      query?: string;
    }) {
      return [
        {
          id: "c-101",
          title:
            "星海科技",
          meta:
            "SaaS · 深圳 · A级",
          value:
            "¥860,000"
        },
        {
          id: "c-102",
          title:
            "远山智能",
          meta:
            "制造业 · 广州 · A级",
          value:
            "¥520,000"
        },
        {
          id: "c-103",
          title:
            "弦月机器人",
          meta:
            "机器人 · 东莞 · B级",
          value:
            "¥310,000"
        },
        {
          id: "c-104",
          title:
            "北辰数据",
          meta:
            "数据服务 · 珠海 · B级",
          value:
            "¥240,000"
        }
      ];
    }
  });

const loadCustomer =
  component({
    id:
      "crm.customer.detail",

    async run(input: {
      id: string;
    }) {
      const data:
        Record<
          string,
          {
            name: string;
            owner: string;
            stage: string;
            revenue: string;
            next: string;
          }
        > = {
          "c-101": {
            name:
              "星海科技",
            owner:
              "陈晓",
            stage:
              "续约谈判",
            revenue:
              "¥860,000",
            next:
              "8月25日 · CTO方案复盘"
          },
          "c-102": {
            name:
              "远山智能",
            owner:
              "林越",
            stage:
              "技术验证",
            revenue:
              "¥520,000",
            next:
              "8月27日 · POC验收"
          },
          "c-103": {
            name:
              "弦月机器人",
            owner:
              "许一",
            stage:
              "商务评估",
            revenue:
              "¥310,000",
            next:
              "9月2日 · 商务报价"
          },
          "c-104": {
            name:
              "北辰数据",
            owner:
              "陈晓",
            stage:
              "需求确认",
            revenue:
              "¥240,000",
            next:
              "8月30日 · 需求 Workshop"
          }
        };

      return (
        data[input.id] ??
        data["c-101"]
      );
    }
  });

const interpret =
  component({
    id:
      "agent.intent.interpret",

    async run(action:
      UserAction) {
      if (
        action.type ===
          "select"
      ) {
        return {
          intent:
            "customer.detail",
          id:
            action.id
        };
      }

      if (
        action.type ===
          "approve-capability" ||
        action.type ===
          "reject-capability"
      ) {
        return {
          intent:
            action.type,
          capabilityId:
            action.capabilityId,
          packageName:
            action.packageName
        };
      }

      const text =
        action.text.trim();

      if (
        /客户|列表|crm/i
          .test(text)
      ) {
        return {
          intent:
            "customer.list",
          query:
            text
        };
      }

      if (
        /汇率|fx|外汇/i
          .test(text)
      ) {
        return {
          intent:
            "capability.install",
          query:
            text
        };
      }

      if (
        /天气|weather|生成.*工具|造.*工具/i
          .test(text)
      ) {
        return {
          intent:
            "capability.generate",
          query:
            text
        };
      }

      if (
        /你好|hello|嗨/i
          .test(text)
      ) {
        return {
          intent:
            "greet"
        };
      }

      return {
        intent:
          "chat",
        text
      };
    }
  });

async function respond(
  action:
    UserAction
): Promise<{
  view: AgentView;
  ambient?: AmbientSurface;
}> {
  const intent =
    await interpret(
      action
    );

  if (
    intent.intent ===
      "customer.list"
  ) {
    const items =
      await searchCustomers({
        query:
          intent.query
      });

    return {
      ambient: {
        kind:
          "agent.progress",
        title:
          "CRM 查询已完成",
        text:
          "这个提示是 display/non-blocking Surface；业务流程没有因为显示它而暂停。",
        tone:
          "success"
      },
      view: {
        kind: "list",
        title:
          "重点客户",
        subtitle:
          "找到 4 个匹配客户 · 点击任意客户继续，或直接输入下一条指令",
        items
      }
    };
  }

  if (
    intent.intent ===
      "customer.detail"
  ) {
    const customer =
      await loadCustomer({
        id:
          String(
            intent.id
          )
      });

    return {
      view: {
        kind: "detail",
        title:
          customer.name,
        fields: [
          {
            label:
              "负责人",
            value:
              customer.owner
          },
          {
            label:
              "当前阶段",
            value:
              customer.stage
          },
          {
            label:
              "预计收入",
            value:
              customer.revenue
          },
          {
            label:
              "下一动作",
            value:
              customer.next
          }
        ],
        actions: [
          "生成跟进摘要",
          "查看关联机会",
          "返回客户列表"
        ]
      }
    };
  }

  if (
    intent.intent ===
      "capability.install"
  ) {
    return {
      ambient: {
        kind:
          "agent.discovery",
        title:
          "发现可复用 Package",
        text:
          "CapabilityResolver 优先命中 installable package，因此不会重复生成同类代码。",
        tone:
          "info"
      },
      view: {
        kind:
          "capability-proposal",
        title:
          "找到现成的汇率转换能力",
        capabilityId:
          "finance.fx.convert",
        packageName:
          "@demo/fx-capability",
        packageVersion:
          "1.4.0",
        resolution:
          "install",
        steps: [
          {
            label:
              "Reuse loaded capability",
            status:
              "done"
          },
          {
            label:
              "Search package catalog",
            status:
              "done"
          },
          {
            label:
              "Trust + sandbox acquisition",
            status:
              "ready"
          },
          {
            label:
              "Human approval",
            status:
              "blocked"
          },
          {
            label:
              "Activate provider",
            status:
              "blocked"
          }
        ],
        note:
          "Agent 可以提出安装建议，但不能把“发现一个包”自动升级成“允许下载和激活”。",
        requiresApproval:
          true
      }
    };
  }

  if (
    intent.intent ===
      "capability.generate"
  ) {
    return {
      ambient: {
        kind:
          "agent.discovery",
        title:
          "现有生态没有安全可复用 Provider",
        text:
          "进入 Generate fallback，但生成代码依旧只形成候选 Package。",
        tone:
          "warning"
      },
      view: {
        kind:
          "capability-proposal",
        title:
          "需要生成新的天气能力 Package",
        capabilityId:
          "weather.forecast",
        packageName:
          "@demo/weather-capability",
        packageVersion:
          "0.1.0",
        resolution:
          "generate",
        steps: [
          {
            label:
              "Reuse existing",
            status:
              "done"
          },
          {
            label:
              "Search installable package",
            status:
              "done"
          },
          {
            label:
              "Generate package candidate",
            status:
              "ready"
          },
          {
            label:
              "Verify + pack + governance",
            status:
              "ready"
          },
          {
            label:
              "Human approval",
            status:
              "blocked"
          }
        ],
        note:
          "生成只是候选变更。后续仍需要 verification、package lifecycle、extension approval 和 release approval。",
        requiresApproval:
          true
      }
    };
  }

  if (
    intent.intent ===
      "approve-capability"
  ) {
    return {
      ambient: {
        kind:
          "extension.audit",
        title:
          "扩展授权已记录",
        text:
          "Demo 只记录 approval 语义，不在宿主机真实下载第三方代码。",
        tone:
          "success"
      },
      view: {
        kind:
          "capability-result",
        title:
          "扩展提议已批准",
        status:
          "approved",
        capabilityId:
          String(
            intent.capabilityId
          ),
        packageName:
          String(
            intent.packageName
          ),
        text:
          "真实部署中，下一步由 ExtensionController → Trust Policy → Sandbox acquisition 执行；会话随后仍可继续。"
      }
    };
  }

  if (
    intent.intent ===
      "reject-capability"
  ) {
    return {
      view: {
        kind:
          "capability-result",
        title:
          "扩展提议已拒绝",
        status:
          "rejected",
        capabilityId:
          String(
            intent.capabilityId
          ),
        packageName:
          String(
            intent.packageName
          ),
        text:
          "拒绝不会影响当前 Agent Execution；你可以继续输入其他任务。"
      }
    };
  }

  if (
    intent.intent ===
      "greet"
  ) {
    return {
      view: {
        kind:
          "message",
        title:
          "你好，我是 UAIR Interactive Agent",
        text:
          "你可以让我查客户、点击业务 UI，也可以让我发现缺失能力。当前会话本身是一条可恢复的长期 Workflow。"
      }
    };
  }

  return {
    view: {
      kind:
        "message",
      title:
        "继续",
      text:
        `我收到：“${String(intent.text ?? "")}”。试试“查重点客户”“我需要汇率转换能力”或“我需要天气工具”。`
    }
  };
}

export const conversationalAgent =
  workflow({
    id:
      "agent.conversation",
    version:
      "2",

    async run() {
      const transcript:
        Array<{
          role:
            | "user"
            | "agent";
          text: string;
        }> = [];

      let view:
        AgentView = {
          kind:
            "welcome",
          title:
            "今天想让我做什么？",
          suggestions: [
            "查一下重点客户列表",
            "我需要一个汇率转换能力",
            "我需要一个天气工具",
            "你好"
          ]
        };

      let ambient:
        AmbientSurface |
        undefined;

      for (
        let turn = 0;
        turn < 50;
        turn += 1
      ) {
        const display =
          ambient
            ? present({
                kind:
                  ambient.kind,
                title:
                  ambient.title,
                version:
                  "1",
                data:
                  ambient
              })
            : undefined;

        const action =
          await surface<
            {
              turn: number;
              view:
                AgentView;
              transcript:
                Array<{
                  role:
                    | "user"
                    | "agent";
                  text: string;
                }>;
              display?: unknown;
              controlFlow: {
                display:
                  "non-blocking";
                currentSurface:
                  "blocking";
              };
            },
            string
          >({
            kind:
              view.kind,
            title:
              view.title,
            version:
              "2",
            data: {
              turn,
              view,
              transcript,
              display,
              controlFlow: {
                display:
                  "non-blocking",
                currentSurface:
                  "blocking"
              }
            },
            hints: {
              preferredPresentation:
                view.kind ===
                  "capability-proposal"
                  ? "modal"
                  : "panel"
            }
          });

        let userAction:
          UserAction;

        if (
          action.type ===
            "approve-capability"
        ) {
          userAction = {
            type:
              "approve-capability",
            capabilityId:
              String(
                action.metadata
                  ?.capabilityId ??
                ""
              ),
            packageName:
              String(
                action.metadata
                  ?.packageName ??
                ""
              )
          };
        } else if (
          action.type ===
            "reject-capability"
        ) {
          userAction = {
            type:
              "reject-capability",
            capabilityId:
              String(
                action.metadata
                  ?.capabilityId ??
                ""
              ),
            packageName:
              String(
                action.metadata
                  ?.packageName ??
                ""
              )
          };
        } else if (
          action.type ===
            "message"
        ) {
          userAction = {
            type:
              "message",
            text:
              String(
                action.value ??
                ""
              )
          };
        } else {
          userAction = {
            type:
              "select",
            id:
              String(
                action.id ??
                action.value ??
                ""
              ),
            label:
              action.label
          };
        }

        transcript.push({
          role:
            "user",
          text:
            userAction.type ===
              "message"
              ? userAction.text
              : userAction.type ===
                  "select"
                ? `选择：${userAction.label ?? userAction.id}`
                : userAction.type ===
                    "approve-capability"
                  ? `批准扩展：${userAction.capabilityId}`
                  : `拒绝扩展：${userAction.capabilityId}`
        });

        const response =
          await respond(
            userAction
          );

        view =
          response.view;

        ambient =
          response.ambient;

        transcript.push({
          role:
            "agent",
          text:
            view.title
        });
      }

      return {
        completed:
          true,
        transcript
      };
    }
  });
