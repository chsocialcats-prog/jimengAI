const DEFAULT_OWNER = "未知";
const READ_ONLY_REASON = "只有创建者可以编辑此内容";

export function projectOwnership(resource = {}) {
  const ownerUsername = typeof resource.owner_username === "string" && resource.owner_username.trim()
    ? resource.owner_username
    : DEFAULT_OWNER;
  const canEdit = resource.can_edit === true;
  return {
    ownerUsername,
    ownerLabel: `创建者：${ownerUsername}`,
    canEdit,
    showEdit: canEdit,
    editVisible: canEdit,
    isReadOnly: !canEdit,
    readOnlyReason: canEdit ? null : READ_ONLY_REASON,
  };
}

export const getOwnershipProjection = projectOwnership;
export const ownershipProjection = projectOwnership;
