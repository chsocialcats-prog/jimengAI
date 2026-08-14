"""Shared-library response projection helpers."""


def project_shared_resource(data, viewer_user_id=None):
    """Expose ownership display fields without trusting a client-side owner id."""
    if data is None:
        return None
    data = dict(data)
    data["owner_username"] = data.get("owner_username") or ""
    data["can_edit"] = bool(
        viewer_user_id is not None and data.get("owner_user_id") == viewer_user_id
    )
    return data
