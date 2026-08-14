export const READ_ONLY_DEMO_CODE = "read_only_demo";

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function deepClone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export class ReadOnlyDemoError extends Error {
  constructor() {
    super("当前为只读演示，无法修改或开始冒险");
    this.name = "ReadOnlyDemoError";
    this.code = READ_ONLY_DEMO_CODE;
    this.status = 403;
  }
}

const BUILTIN_DEMO_DATA = {
  works: [
    {
      id: "demo-work",
      title: "雾港来信",
      description: "一个适合浏览的内置冒险示例。",
      owner_username: "演示资料库",
      can_edit: false,
      card_ids: ["demo-card"],
      worldbook_id: "demo-worldbook",
    },
  ],
  cards: [
    {
      id: "demo-card",
      name: "雾港引路人",
      title: "雾港引路人",
      description: "温和而谨慎的引路角色。",
      owner_username: "演示资料库",
      can_edit: false,
    },
  ],
  worldbooks: [
    {
      id: "demo-worldbook",
      name: "雾港设定集",
      title: "雾港设定集",
      entries: [
        { id: "demo-entry", keywords: ["雾港"], content: "海雾每天黄昏准时升起。" },
      ],
      owner_username: "演示资料库",
      can_edit: false,
    },
  ],
};

export const readOnlyDemoData = deepFreeze(BUILTIN_DEMO_DATA);

function readOnlyOperation() {
  throw new ReadOnlyDemoError();
}

export function createReadOnlyDemoAdapter() {
  return {
    mode: "read-only-demo",
    isReadOnly: true,
    getSnapshot: () => deepClone(readOnlyDemoData),
    listWorks: () => deepClone(readOnlyDemoData.works),
    listCards: () => deepClone(readOnlyDemoData.cards),
    listWorldbooks: () => deepClone(readOnlyDemoData.worldbooks),
    create: readOnlyOperation,
    update: readOnlyOperation,
    delete: readOnlyOperation,
    startAdventure: readOnlyOperation,
    save: readOnlyOperation,
  };
}
