// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AgentMandate
/// @notice The agent's on-chain **employment contract** — plan §17.2. Extends the covenant idea
/// proven in {SweepEscrow} into the full mandate model: an owner (the human/company principal)
/// grants a registered agent a bounded authority to move treasury USDC, and can revoke or exit at
/// any time. This is what turns "a hot-wallet agent that terrifies a CFO" into "the version a CFO
/// would actually hire."
///
/// @dev USDC is Arc's native gas token, so treasury balances here are native currency (msg.value),
/// exactly like {SweepEscrow}. The contract tracks two pools:
///   - `companyBalance`  — the company's liquid position the agent must never draw below `floorUsdc`.
///   - `deployedBalance` — surplus the agent has moved into yield (held by this contract as escrow).
/// The whole system in one asymmetry (§17.2):
///   - **deposit** (company → deployed, i.e. RISK-ADDING) is TRIPLE-GATED: floor, per-ticket cap,
///     rolling-24h cap, and blocked entirely when revoked.
///   - **withdrawToCompany** (deployed → company, i.e. RISK-REDUCING) is NEVER gated — not even
///     when revoked. Moving money back toward safety must always be allowed. This is the
///     production fail-safe ("being wrong must cost opportunity, never solvency") expressed in
///     Solidity.
/// Decision receipts: each money move carries `decisionId` (idempotency key) and `forecastHash`
/// (the snapshot the agent acted on), emitted in {DecisionExecuted} — event-only, no storage
/// mapping (cheap, sufficient, indexable). A reused `decisionId` MUST revert.
///
/// STATUS: interface skeleton. Signatures, roles, events, and gating semantics are pinned; the
/// money-movement + idempotency bodies are TODO(Vadim) and the matching tests are `it.skip` in
/// test/AgentMandate.test.ts until implemented. Owner-admin setters are implemented (low risk).
contract AgentMandate {
    // ─── Roles ───────────────────────────────────────────────────────────────
    address public owner; // the company / human principal
    address public agent; // the agent's signer address (must be ERC-8004-registered)

    // ─── Mandate (the on-chain employment contract) ──────────────────────────
    uint256 public floorUsdc; // company-wallet balance the agent must never breach
    uint256 public maxTicketUsdc; // per-transaction cap
    uint256 public dailyCapUsdc; // rolling-24h deployment cap
    bool public revoked;

    // ─── Treasury pools ──────────────────────────────────────────────────────
    uint256 public companyBalance; // liquid position, floor-protected
    uint256 public deployedBalance; // surplus escrowed in yield

    // ─── Rolling-24h accounting (deposit cap) ────────────────────────────────
    // TODO(Vadim): window bookkeeping for the rolling 24h deployment total.
    uint256 public windowStart;
    uint256 public windowDeployed;

    // ─── Idempotency ─────────────────────────────────────────────────────────
    mapping(bytes32 => bool) public decisionUsed; // decisionId => seen

    // ─── Events (§17.2) ──────────────────────────────────────────────────────
    /// @param kind mirrors the app-layer DecisionKind: 0=DEPLOY, 1=WITHDRAW, 2=HOLD, 3=FLOOR_RAISE.
    event DecisionExecuted(bytes32 indexed decisionId, uint8 kind, uint256 amount, bytes32 forecastHash);
    event MandateChanged(uint256 floor, uint256 maxTicket, uint256 dailyCap);
    event Revoked(address by);
    event Reinstated(address by);
    event CompanyFunded(uint256 amount, uint256 newCompanyBalance);
    event EmergencyWithdrawal(address to, uint256 amount);

    // ─── Errors ──────────────────────────────────────────────────────────────
    error NotOwner();
    error NotAgent();
    error MandateRevoked();
    error FloorBreach(uint256 requested, uint256 companyBalanceAfter, uint256 floor);
    error TicketCapExceeded(uint256 requested, uint256 maxTicket);
    error DailyCapExceeded(uint256 requested, uint256 windowUsed, uint256 dailyCap);
    error DuplicateDecision(bytes32 decisionId);
    error InsufficientDeployed(uint256 requested, uint256 available);
    error TransferFailed();
    error NotImplemented();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAgent() {
        if (msg.sender != agent) revert NotAgent();
        _;
    }

    modifier whenNotRevoked() {
        if (revoked) revert MandateRevoked();
        _;
    }

    /// @param agent_ the agent signer (ERC-8004-registered address).
    constructor(address agent_, uint256 floor_, uint256 maxTicket_, uint256 dailyCap_) {
        owner = msg.sender;
        agent = agent_;
        floorUsdc = floor_;
        maxTicketUsdc = maxTicket_;
        dailyCapUsdc = dailyCap_;
        emit MandateChanged(floor_, maxTicket_, dailyCap_);
    }

    // ─── Owner funding & exit ────────────────────────────────────────────────

    /// @notice Owner seeds the company's liquid position (native USDC).
    function fundCompany() external payable onlyOwner {
        companyBalance += msg.value;
        emit CompanyFunded(msg.value, companyBalance);
    }

    /// @notice Owner exit — unconditional. Sweeps everything (company + deployed) back to the owner.
    /// @dev TODO(Vadim): sum both pools, zero them, transfer, emit EmergencyWithdrawal.
    function emergencyWithdrawAll() external onlyOwner {
        revert NotImplemented();
    }

    // ─── Agent actions ───────────────────────────────────────────────────────

    /// @notice DEPLOY: agent moves `amount` company→deployed (surplus into yield). RISK-ADDING,
    /// therefore triple-gated and blocked when revoked.
    /// @dev TODO(Vadim): REVERTS if
    ///   - `companyBalance - amount < floorUsdc`      → FloorBreach
    ///   - `amount > maxTicketUsdc`                   → TicketCapExceeded
    ///   - rolling-24h deployed + amount > dailyCapUsdc → DailyCapExceeded
    ///   - `decisionUsed[decisionId]`                 → DuplicateDecision
    /// On success: update pools + window, mark decisionId, emit DecisionExecuted(kind=0).
    function deposit(uint256 amount, bytes32 decisionId, bytes32 forecastHash)
        external
        onlyAgent
        whenNotRevoked
    {
        amount;
        decisionId;
        forecastHash;
        revert NotImplemented();
    }

    /// @notice WITHDRAW: agent moves `amount` deployed→company (back toward safety). RISK-REDUCING,
    /// therefore NEVER gated — deliberately callable even when `revoked` (fail-safe in Solidity).
    /// @dev TODO(Vadim): REVERTS only on `amount > deployedBalance` (InsufficientDeployed) or a
    /// reused `decisionId` (DuplicateDecision). On success: update pools, mark decisionId, emit
    /// DecisionExecuted(kind=1). No floor/ticket/daily/revoked checks.
    function withdrawToCompany(uint256 amount, bytes32 decisionId, bytes32 forecastHash)
        external
        onlyAgent
    {
        amount;
        decisionId;
        forecastHash;
        revert NotImplemented();
    }

    // ─── Owner mandate controls (implemented — low risk) ─────────────────────

    /// @notice Owner adjusts the mandate bounds. "You can retune your CFO agent on-chain."
    function setMandate(uint256 floor_, uint256 maxTicket_, uint256 dailyCap_) external onlyOwner {
        floorUsdc = floor_;
        maxTicketUsdc = maxTicket_;
        dailyCapUsdc = dailyCap_;
        emit MandateChanged(floor_, maxTicket_, dailyCap_);
    }

    /// @notice Owner revokes the mandate. Blocks future deposits; withdrawals stay allowed.
    /// "You can fire your CFO agent at any time." (Demo Day kicker, §11.)
    function revoke() external onlyOwner {
        revoked = true;
        emit Revoked(msg.sender);
    }

    /// @notice Owner re-hires the agent.
    function reinstate() external onlyOwner {
        revoked = false;
        emit Reinstated(msg.sender);
    }
}
