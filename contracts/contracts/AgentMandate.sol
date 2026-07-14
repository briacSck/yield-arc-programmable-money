// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AgentMandate
/// @notice The agent's on-chain **employment contract** — plan §17.2. Extends the covenant idea
/// proven in {SweepEscrow} into the full mandate model: an owner (the human/company principal)
/// grants a registered agent a bounded authority to move treasury USDC, and can revoke or exit at
/// any time. This is what turns "a hot-wallet agent that terrifies a CFO" into "the version a CFO
/// would actually hire."
///
/// @dev UNITS: all accounting (floor, caps, pools, amounts) is in **6-decimal USDC base units** —
/// identical to the app-layer `Decision.amountUsdc` and Arc's USDC ERC-20 view. USDC is Arc's
/// native gas token with 18-decimal native precision, so the fixed `SCALE = 1e12` converts at the
/// two native-value boundaries only: {fundCompany} (native in) and {emergencyWithdrawAll}
/// (native out). Nothing else touches native value.
///
/// The contract tracks two pools (labels over the native balance this contract escrows):
///   - `companyBalance`  — the company's liquid position the agent must never draw below `floorUsdc`.
///   - `deployedBalance` — surplus the agent has moved into yield (escrowed here; the W2+ venue
///     swap happens behind this seam without changing the interface).
///
/// The whole system in one asymmetry (§17.2):
///   - **deposit** (company → deployed, RISK-ADDING) is TRIPLE-GATED: floor, per-ticket cap,
///     24h budget window, and blocked entirely when revoked. Pure pool accounting — no external
///     calls, hence no reentrancy surface.
///   - **withdrawToCompany** (deployed → company, RISK-REDUCING) is NEVER gated — not even when
///     revoked. Moving money back toward safety must always be allowed. Also pure pool accounting.
///
/// The 24h cap is a FIXED BUDGET WINDOW (tumbling), not a rolling window: the window resets 24h
/// after it opened, so up to 2× `dailyCapUsdc` can deploy across one boundary. Documented and
/// pinned by test — the simple algorithm is the point ("quality of execution over complexity").
///
/// Two-floor doctrine: `floorUsdc` here is the owner-set HARD bound; the agent's dynamic
/// `safe_floor` (§16.3) must sit at or above it by configuration. `FLOOR_RAISE` decisions are
/// advisory/off-chain only — the agent cannot change its own mandate (`setMandate` is onlyOwner).
///
/// Decision receipts: each money move carries `decisionId` (idempotency key, derived off-chain as
/// keccak(inputsHash ‖ kind ‖ asOf) — wall-clock-independent so retries collide here) and
/// `forecastHash` (the snapshot the agent acted on), emitted in {DecisionExecuted}. A reused
/// `decisionId` REVERTS.
contract AgentMandate {
    // ─── Units ───────────────────────────────────────────────────────────────
    /// @notice native (18-dec) wei per 6-dec USDC base unit.
    uint256 public constant SCALE = 1e12;

    // ─── Roles ───────────────────────────────────────────────────────────────
    address public owner; // the company / human principal
    address public agent; // the agent's signer address (must be ERC-8004-registered)

    // ─── Mandate (the on-chain employment contract) ──────────────────────────
    uint256 public floorUsdc; // company balance the agent must never breach (6-dec)
    uint256 public maxTicketUsdc; // per-transaction cap (6-dec)
    uint256 public dailyCapUsdc; // 24h-budget-window deployment cap (6-dec)
    bool public revoked;

    // ─── Treasury pools (6-dec USDC base units) ──────────────────────────────
    uint256 public companyBalance; // liquid position, floor-protected
    uint256 public deployedBalance; // surplus escrowed in yield

    // ─── 24h budget window (tumbling; see contract doc) ─────────────────────
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
    error FloorBreach(uint256 requested, uint256 companyBalance_, uint256 floor);
    error TicketCapExceeded(uint256 requested, uint256 maxTicket);
    error DailyCapExceeded(uint256 requested, uint256 windowUsed, uint256 dailyCap);
    error DuplicateDecision(bytes32 decisionId);
    error InsufficientDeployed(uint256 requested, uint256 available);
    error TransferFailed();
    error InvalidConstruction();
    error InvalidNativeAmount(uint256 value);

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

    /// @param agent_ the agent signer (ERC-8004-registered address). Must be a real, distinct
    /// address — a zero or owner-equal agent yields a dead-on-arrival mandate holding funds.
    constructor(address agent_, uint256 floor_, uint256 maxTicket_, uint256 dailyCap_) {
        if (agent_ == address(0) || agent_ == msg.sender || maxTicket_ == 0 || maxTicket_ > dailyCap_) {
            revert InvalidConstruction();
        }
        owner = msg.sender;
        agent = agent_;
        floorUsdc = floor_;
        maxTicketUsdc = maxTicket_;
        dailyCapUsdc = dailyCap_;
        emit MandateChanged(floor_, maxTicket_, dailyCap_);
    }

    // ─── Owner funding & exit ────────────────────────────────────────────────

    /// @notice Owner seeds the company's liquid position with native USDC. The native value must
    /// be a whole multiple of SCALE so the 6-dec pool records it exactly (no dust truncation).
    function fundCompany() external payable onlyOwner {
        if (msg.value == 0 || msg.value % SCALE != 0) revert InvalidNativeAmount(msg.value);
        companyBalance += msg.value / SCALE;
        emit CompanyFunded(msg.value / SCALE, companyBalance);
    }

    /// @notice Owner exit — unconditional (works even when revoked). Sweeps everything
    /// (company + deployed) back to the owner. CEI: pools are zeroed before the native transfer.
    function emergencyWithdrawAll() external onlyOwner {
        uint256 totalUsdc = companyBalance + deployedBalance;
        companyBalance = 0;
        deployedBalance = 0;
        uint256 nativeValue = totalUsdc * SCALE;
        (bool ok, ) = owner.call{value: nativeValue}("");
        if (!ok) revert TransferFailed();
        emit EmergencyWithdrawal(owner, totalUsdc);
    }

    // ─── Agent actions (pure pool accounting — no external calls) ────────────

    /// @notice DEPLOY: agent moves `amount` company→deployed (surplus into yield). RISK-ADDING,
    /// therefore triple-gated and blocked when revoked.
    /// @dev Gate order: replay → floor (addition form — the subtraction form would panic on
    /// underflow before reaching the named error) → ticket cap → 24h budget window.
    function deposit(uint256 amount, bytes32 decisionId, bytes32 forecastHash)
        external
        onlyAgent
        whenNotRevoked
    {
        if (decisionUsed[decisionId]) revert DuplicateDecision(decisionId);
        if (companyBalance < amount + floorUsdc) revert FloorBreach(amount, companyBalance, floorUsdc);
        if (amount > maxTicketUsdc) revert TicketCapExceeded(amount, maxTicketUsdc);
        if (block.timestamp >= windowStart + 24 hours) {
            windowStart = block.timestamp;
            windowDeployed = 0;
        }
        if (windowDeployed + amount > dailyCapUsdc) {
            revert DailyCapExceeded(amount, windowDeployed, dailyCapUsdc);
        }

        decisionUsed[decisionId] = true;
        windowDeployed += amount;
        companyBalance -= amount;
        deployedBalance += amount;
        emit DecisionExecuted(decisionId, 0, amount, forecastHash);
    }

    /// @notice WITHDRAW: agent moves `amount` deployed→company (back toward safety). RISK-REDUCING,
    /// therefore NEVER gated — deliberately callable even when `revoked` (fail-safe in Solidity).
    /// Reverts only on replay or over-withdrawal.
    function withdrawToCompany(uint256 amount, bytes32 decisionId, bytes32 forecastHash)
        external
        onlyAgent
    {
        if (decisionUsed[decisionId]) revert DuplicateDecision(decisionId);
        if (amount > deployedBalance) revert InsufficientDeployed(amount, deployedBalance);

        decisionUsed[decisionId] = true;
        deployedBalance -= amount;
        companyBalance += amount;
        emit DecisionExecuted(decisionId, 1, amount, forecastHash);
    }

    // ─── Owner mandate controls ──────────────────────────────────────────────

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
