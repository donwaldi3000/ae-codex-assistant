"""Typed contracts for agent-safe operation execution."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List
import uuid


class Scope(str, Enum):
    SELECTION = "Selection"
    ACTIVE_COMP = "ActiveComp"
    PROJECT = "Project"


class RiskMode(str, Enum):
    SAFE = "Safe"
    BALANCED = "Balanced"
    FAST = "Fast"


class RiskLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class ApprovalOverride(str, Enum):
    DEFAULT = "Default"
    ASK_THIS_TIME = "AskThisTime"
    AUTO_APPLY_THIS_TIME = "AutoApplyThisTime"


@dataclass
class CommandEnvelope:
    command: str
    payload: Dict[str, Any] = field(default_factory=dict)
    id: str = field(default_factory=lambda: f"op_{uuid.uuid4().hex[:12]}")
    scope: Scope = Scope.ACTIVE_COMP
    risk: RiskLevel | None = None
    requires_approval: bool | None = None

    def to_dict(self) -> Dict[str, Any]:
        data: Dict[str, Any] = {
            "id": self.id,
            "command": self.command,
            "scope": self.scope.value,
            "payload": self.payload,
        }
        if self.risk is not None:
            data["risk"] = self.risk.value
        if self.requires_approval is not None:
            data["requiresApproval"] = self.requires_approval
        return data


@dataclass
class OperationResult:
    status: str
    operation_id: str
    command: str
    risk: str
    requires_approval: bool
    applied: bool
    changed_entities: List[Dict[str, Any]]
    warnings: List[str]
    undo_group_id: str | None
    audit_record_id: str | None
    details: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_payload(cls, payload: Dict[str, Any]) -> "OperationResult":
        return cls(
            status=str(payload.get("status", "error")),
            operation_id=str(payload.get("operationId", "")),
            command=str(payload.get("command", "")),
            risk=str(payload.get("risk", "medium")),
            requires_approval=bool(payload.get("requiresApproval", False)),
            applied=bool(payload.get("applied", False)),
            changed_entities=list(payload.get("changedEntities", [])),
            warnings=list(payload.get("warnings", [])),
            undo_group_id=payload.get("undoGroupId"),
            audit_record_id=payload.get("auditRecordId"),
            details=dict(payload.get("details", {})),
        )
