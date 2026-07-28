// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice The 6-decimal ERC-20 surface this contract needs. On Arc this is the NATIVE USDC gas
/// token's ERC-20 interface at `0x3600…0000` — the same balance as `address(this).balance`, viewed
/// at 6 decimals instead of 18 (docs.arc.io "Two interfaces, one balance").
interface IERC20Minimal {
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @notice The yield-venue seam — the Solidity twin of `agent/src/chain/usyc-venue.ts`'s `IVenue`.
///
/// Shaped after Circle's USYC **Teller** (`0x9fdF…C105A` on Arc testnet), which is ERC-4626-like
/// but keeps the share token SEPARATE from the vault (hence `share()`, which strict 4626 lacks).
/// Any other venue reaches this contract through a thin adapter implementing exactly this.
interface IYieldVenue {
    /// @notice The asset the venue subscribes — MUST equal this mandate's `usdc`.
    function asset() external view returns (address);
    /// @notice The ERC-20 share token minted to the subscriber.
    function share() external view returns (address);
    /// @notice Subscribe `assets` (6-dec) and mint shares to `receiver`. Pulls via allowance.
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    /// @notice Burn `shares` from `account`, sending assets to `receiver`. caller == account here.
    function redeem(uint256 shares, address receiver, address account) external returns (uint256 assets);
    /// @notice Shares needed to realise `assets` — advisory; a failure falls back to pro-rata.
    function previewWithdraw(uint256 assets) external view returns (uint256 shares);
}

/// @title AgentMandateV2 — venue-aware agent mandate
/// @notice v2 of {AgentMandate}. **Deployed ALONGSIDE v1, never replacing it.** v1 stays frozen and
/// keeps its history; the verifier already takes `--address`, so two live mandates is a feature.
///
/// ## Why v2 exists
/// v1's `deposit()` is pure pool accounting: it moves numbers between `companyBalance` and
/// `deployedBalance` while the USDC never leaves the contract. "The deployed surplus earns yield"
/// is therefore FALSE for v1. v2 makes it true by pushing the deployed leg into a real venue and
/// pulling it back on withdrawal.
///
/// ## What is deliberately unchanged (the verifier's contract)
/// `npx tsx verifier/src/cli.ts --address <v2> --deploy-block <n>` must produce the same five
/// verdicts it produces for v1, from the same fixed 6-event ABI. So v2 keeps, byte-for-byte:
///   - the six event signatures, including
///     `DecisionExecuted(bytes32 indexed decisionId, uint8 kind, uint256 amount, bytes32 forecastHash)`;
///   - `decisionId = keccak256(utf8("<inputsHash>|<DEPLOY|WITHDRAW>"))`, derived off-chain, replayed
///     on-chain only as an idempotency key (a reuse REVERTS);
///   - the deposit gate ORDER — replay → floor (addition form) → ticket cap → 24h window;
///   - the 24h **tumbling** budget window: reset iff `ts >= windowStart + 86400` **at a deposit**,
///     with `windowStart` set to that deposit's timestamp (so ≤2× `dailyCapUsdc` can cross one
///     boundary — documented, intentional, pinned by test);
///   - the post-revocation asymmetry: deposits blocked, withdrawals ALWAYS allowed by the mandate.
///
/// **Reconstruction rule (the constraint that shaped every accounting choice below).** The verifier
/// rebuilds `companyBalance` purely from `CompanyFunded.amount` and `DecisionExecuted.amount`, and
/// checks the floor against *that* reconstruction. So **every base unit that enters or leaves
/// `companyBalance` must be visible in one of those events, with the same number.** A hidden credit
/// would make the verifier's balance lag reality and manufacture false floor VIOLATIONs. That is
/// why there is no "sync donations" function, why `rescueToken` refuses USDC, and why — see
/// {withdrawToCompany} — the withdrawal receipt carries the amount that **actually settled**, not
/// the amount that was requested.
///
/// ## Arc native/ERC-20 duality (verified on Arc testnet 2026-07-28, read-only)
/// USDC is Arc's native gas token. Native (18-dec) and the ERC-20 interface at `0x3600…0000`
/// (6-dec) are TWO VIEWS OF ONE BALANCE, and this holds for CONTRACT accounts, not just EOAs:
///   - `USDC.balanceOf(<v1 mandate>) == address(<v1 mandate>).balance / 1e12` exactly;
///   - a contract can `approve`/`transfer` its own balance through `0x3600…0000`;
///   - an ERC-20 `transfer` INTO a contract with no `receive()` SUCCEEDS (the precompile mutates
///     balances, it does not `CALL`) — while a plain native send to the same contract REVERTS.
/// Consequences: v2 needs no `receive()`/`fallback` (and deliberately has none, exactly like v1),
/// yet the venue can still pay it on redemption; and because pools are already denominated in
/// 6-dec base units, they map 1:1 onto the ERC-20 interface with **no scaling at all**. `SCALE`
/// survives at exactly one boundary — {fundCompany}, which takes 18-dec `msg.value`.
///
/// ## NAV: what was chosen and why
/// A venue round-trip does not conserve USDC. Measured on Arc testnet: 1.000000 USDC subscribes to
/// 0.883092 USYC, and 1.000000 USYC redeems to 1.132275 USDC — a ~12bp round-trip cost today, and
/// a position whose USDC value drifts with the fund's NAV thereafter.
///
/// v2 keeps `deployedBalance` as a **USDC cost basis** and tracks the position itself in
/// `deployedShares`. Rationale: cost basis is reconstructible from events alone, NAV is not; and
/// keeping `deposit`'s arithmetic identical to v1 is what preserves the verifier's replay.
///
/// On withdrawal the contract redeems shares and credits **what actually arrived** (`credited`).
/// `companyBalance` therefore moves by exactly the number the receipt carries, which is what keeps
/// the verifier's reconstruction exact under any NAV path. The gain or loss versus cost basis is
/// never hidden: it lands in `companyBalance`, is carried by the receipt, and is itemised in
/// {VenueRedeemed}.
///
/// A **full unwind** (`amount >= deployedBalance` — "give me the position back") redeems every
/// share, not merely the shares that cover the cost basis; otherwise an accrued gain would strand
/// as residual shares no withdrawal could ever reach again. Closing the position then zeroes the
/// basis: a shortfall left over after a loss is a REALISED loss, not a claim on money that exists.
/// A **partial** withdrawal takes only the shares it needs and leaves the rest invested.
///
/// One honest caveat about the replay. `companyBalance` stays exact in the verifier at every step.
/// `deployedBalance` can end up LOWER in the contract than in the replay after a realised loss,
/// because closing the position zeroes the basis while `replay.ts` can only subtract the receipt
/// amount. That pool is never read by any of the five invariants — only mutated — so the verdict is
/// unaffected; the divergence is recorded here rather than left to be discovered.
///
/// ## Emergency exit when the venue is stuck
/// {emergencyWithdrawAll} `try`s the venue redemption and CONTINUES on failure ({VenueExitFailed}),
/// then sweeps the contract's entire reachable USDC balance to the owner. Shares that could not be
/// redeemed stay in the contract and the owner recovers them with {rescueToken} (which refuses
/// USDC, since an invisible USDC exit would break the reconstruction rule above). The owner exit is
/// never blocked by the venue.
///
/// ## Residual risk stated plainly
/// v1's `withdrawToCompany` had no external calls and could not fail. v2's can: if the venue
/// reverts, the withdrawal reverts ({VenueRedeemFailed}) and the agent retries. The MANDATE never
/// blocks a withdrawal — no floor, ticket, window, or revocation gate applies, which is the
/// invariant the verifier checks — but venue liveness is now a dependency the escrow model did not
/// have. The owner's unconditional exit is the backstop.
contract AgentMandateV2 {
    // ─── Units ───────────────────────────────────────────────────────────────
    /// @notice native (18-dec) wei per 6-dec USDC base unit. Used at {fundCompany} only.
    uint256 public constant SCALE = 1e12;

    // ─── Roles ───────────────────────────────────────────────────────────────
    address public owner; // the company / human principal
    address public agent; // the agent's signer address (must be ERC-8004-registered)

    /// @notice The 6-dec USDC ERC-20 interface. `0x3600000000000000000000000000000000000000` on Arc.
    /// Immutable: the asset a mandate is denominated in is not a tunable.
    address public immutable usdc;

    // ─── Mandate (the on-chain employment contract) ──────────────────────────
    uint256 public floorUsdc; // company balance the agent must never breach (6-dec)
    uint256 public maxTicketUsdc; // per-transaction cap (6-dec)
    uint256 public dailyCapUsdc; // 24h-budget-window deployment cap (6-dec)
    bool public revoked;

    // ─── Treasury pools (6-dec USDC base units) ──────────────────────────────
    uint256 public companyBalance; // liquid position held by this contract, floor-protected
    uint256 public deployedBalance; // COST BASIS of the venue position (see NAV note above)

    // ─── Venue seam ──────────────────────────────────────────────────────────
    /// @notice The yield venue, or `address(0)` for "escrow only" — v1 behaviour, and the state a
    /// fresh v2 starts in so it can be deployed and verified BEFORE the venue permissions it.
    address public venue;
    /// @notice The venue's share token, cached at {setVenue}. Zero when `venue` is unset.
    address public venueShare;
    /// @notice Venue share units currently held by this contract (the actual position).
    uint256 public deployedShares;

    // ─── 24h budget window (tumbling; see contract doc) ─────────────────────
    uint256 public windowStart;
    uint256 public windowDeployed;

    // ─── Idempotency ─────────────────────────────────────────────────────────
    mapping(bytes32 => bool) public decisionUsed; // decisionId => seen

    // ─── Reentrancy (v1 needed none — it made no external calls) ─────────────
    uint256 private _lock = 1;

    // ─── Events: the six the verifier's fixed ABI decodes — IDENTICAL to v1 ──
    /// @param kind mirrors the app-layer DecisionKind: 0=DEPLOY, 1=WITHDRAW, 2=HOLD, 3=FLOOR_RAISE.
    event DecisionExecuted(bytes32 indexed decisionId, uint8 kind, uint256 amount, bytes32 forecastHash);
    event MandateChanged(uint256 floor, uint256 maxTicket, uint256 dailyCap);
    event Revoked(address by);
    event Reinstated(address by);
    event CompanyFunded(uint256 amount, uint256 newCompanyBalance);
    event EmergencyWithdrawal(address to, uint256 amount);

    // ─── Events: v2 additions. The verifier ignores unknown topics (`parseEventLogs` with
    //     `strict: false`) and merely counts them, so these are additive and safe. ────────────
    event VenueChanged(address indexed venue, address indexed share);
    event VenueSubscribed(bytes32 indexed decisionId, uint256 assetsIn, uint256 sharesMinted);
    event VenueRedeemed(bytes32 indexed decisionId, uint256 sharesBurned, uint256 assetsOut, uint256 assetsRequested);
    event VenueExitFailed(uint256 sharesStranded);
    event TokenRescued(address indexed token, address indexed to, uint256 amount);

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
    // v2 additions
    error Reentrancy();
    error VenueBusy(uint256 sharesHeld);
    error VenueAssetMismatch(address venueAsset, address expected);
    error VenueMintedNothing(uint256 assetsIn);
    error VenueRedeemedNothing(uint256 sharesBurned);
    error VenueRedeemFailed(uint256 shares, bytes reason);
    error CannotRescueUsdc();
    error InvalidRecipient();

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

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    /// @param agent_ the agent signer (ERC-8004-registered address). Must be real and distinct — a
    /// zero or owner-equal agent yields a dead-on-arrival mandate holding funds.
    /// @param usdc_ the 6-dec USDC ERC-20 interface (`0x3600…0000` on Arc; a mock under Hardhat).
    /// @dev The venue starts UNSET on purpose: deploy first, verify, then {setVenue} once the venue
    /// has permissioned this contract's address. Constructor args otherwise match v1 exactly.
    constructor(address agent_, uint256 floor_, uint256 maxTicket_, uint256 dailyCap_, address usdc_) {
        if (
            agent_ == address(0) || agent_ == msg.sender || maxTicket_ == 0 || maxTicket_ > dailyCap_
                || usdc_ == address(0)
        ) {
            revert InvalidConstruction();
        }
        owner = msg.sender;
        agent = agent_;
        usdc = usdc_;
        floorUsdc = floor_;
        maxTicketUsdc = maxTicket_;
        dailyCapUsdc = dailyCap_;
        emit MandateChanged(floor_, maxTicket_, dailyCap_);
    }

    // ─── Owner funding & exit ────────────────────────────────────────────────

    /// @notice Owner seeds the company's liquid position with native USDC. Unchanged from v1: the
    /// native value must be a whole multiple of SCALE so the 6-dec pool records it exactly.
    /// @dev This is the ONLY path that may increase `companyBalance` outside a WITHDRAW receipt —
    /// see the reconstruction rule in the contract doc. A raw ERC-20 USDC transfer to this address
    /// is a donation: it raises the reachable balance, is swept by {emergencyWithdrawAll}, and is
    /// deliberately NOT credited to any pool, because the verifier could not see it.
    function fundCompany() external payable onlyOwner {
        if (msg.value == 0 || msg.value % SCALE != 0) revert InvalidNativeAmount(msg.value);
        companyBalance += msg.value / SCALE;
        emit CompanyFunded(msg.value / SCALE, companyBalance);
    }

    /// @notice Owner exit — unconditional (works when revoked, and when the venue is broken).
    /// Attempts to unwind the whole venue position, then sweeps every USDC base unit this contract
    /// can reach to the owner.
    /// @dev If the venue reverts, {VenueExitFailed} is emitted and the sweep proceeds anyway: the
    /// owner gets everything liquid now and recovers the stranded shares with {rescueToken}.
    /// Pools are zeroed BEFORE the outbound transfer (CEI) and the whole call is `nonReentrant`.
    function emergencyWithdrawAll() external onlyOwner nonReentrant {
        address v = venue;
        uint256 shares = deployedShares;
        if (v != address(0) && shares != 0) {
            try IYieldVenue(v).redeem(shares, address(this), address(this)) returns (uint256) {
                deployedShares = IERC20Minimal(venueShare).balanceOf(address(this));
            } catch {
                emit VenueExitFailed(shares);
            }
        }

        companyBalance = 0;
        deployedBalance = 0;

        uint256 sweep = _liquidUsdc();
        if (sweep != 0) _sendUsdc(owner, sweep);
        emit EmergencyWithdrawal(owner, sweep);
    }

    // ─── Agent actions ───────────────────────────────────────────────────────

    /// @notice DEPLOY: agent moves `amount` company→deployed AND subscribes it into the venue.
    /// RISK-ADDING, therefore triple-gated and blocked when revoked — exactly as in v1.
    /// @dev Gate order is v1's, unchanged: replay → floor (addition form — the subtraction form
    /// would panic on underflow before reaching the named error) → ticket cap → 24h window.
    /// Pools mutate BEFORE the venue call (CEI); `nonReentrant` covers the rest.
    /// The allowance is set to exactly `amount` and reset to 0 afterwards, so a venue can never
    /// pull more than the ticket it was authorised for, and no standing allowance survives.
    function deposit(uint256 amount, bytes32 decisionId, bytes32 forecastHash)
        external
        onlyAgent
        whenNotRevoked
        nonReentrant
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

        address v = venue;
        if (v != address(0)) {
            address shareToken = venueShare;
            uint256 sharesBefore = IERC20Minimal(shareToken).balanceOf(address(this));
            _approveUsdc(v, amount);
            IYieldVenue(v).deposit(amount, address(this));
            _approveUsdc(v, 0);
            uint256 minted = IERC20Minimal(shareToken).balanceOf(address(this)) - sharesBefore;
            // A subscription that mints nothing would silently convert treasury into nothing.
            if (minted == 0) revert VenueMintedNothing(amount);
            deployedShares += minted;
            emit VenueSubscribed(decisionId, amount, minted);
        }

        emit DecisionExecuted(decisionId, 0, amount, forecastHash);
    }

    /// @notice WITHDRAW: agent redeems from the venue and moves the proceeds deployed→company.
    /// RISK-REDUCING, therefore NEVER gated by the mandate — deliberately callable even when
    /// `revoked`. Reverts only on replay, over-withdrawal, or a venue that will not pay.
    ///
    /// @param amount the USDC the agent is ASKING for (cost-basis units). The receipt carries what
    /// actually SETTLED, which may differ:
    ///   - **NAV drift** — the shares sized for `amount` may realise more or less USDC. Whatever
    ///     arrives is credited to `companyBalance` and emitted as the receipt amount, so the
    ///     verifier's reconstruction stays exact and the gain/loss is on the record rather than
    ///     buried in an unobservable pool.
    ///   - **Partial redeem** — if the position holds fewer shares than `amount` needs (only
    ///     possible after a loss), every remaining share is redeemed and the receipt is smaller.
    /// {VenueRedeemed} itemises shares burned, assets out, and assets requested for the audit trail.
    ///
    /// @dev `deployedBalance` is reduced by the SETTLED amount using the same `>= ? - : 0` clamp
    /// `verifier/src/core/replay.ts` applies, so contract state and replay state never diverge.
    /// State is written after the external call by necessity (the amount is only knowable then);
    /// `nonReentrant` is what makes that safe.
    function withdrawToCompany(uint256 amount, bytes32 decisionId, bytes32 forecastHash)
        external
        onlyAgent
        nonReentrant
    {
        if (decisionUsed[decisionId]) revert DuplicateDecision(decisionId);
        if (amount > deployedBalance) revert InsufficientDeployed(amount, deployedBalance);

        decisionUsed[decisionId] = true;

        uint256 credited = amount;
        bool positionClosed = false;
        address v = venue;
        if (v != address(0) && deployedShares != 0) {
            address shareToken = venueShare;
            uint256 shares = _sharesFor(v, amount);
            uint256 usdcBefore = _liquidUsdc();
            uint256 sharesBefore = IERC20Minimal(shareToken).balanceOf(address(this));

            try IYieldVenue(v).redeem(shares, address(this), address(this)) returns (uint256) {
                // proceeds are measured, never trusted from the return value
            } catch (bytes memory reason) {
                revert VenueRedeemFailed(shares, reason);
            }

            uint256 burned = sharesBefore - IERC20Minimal(shareToken).balanceOf(address(this));
            credited = _liquidUsdc() - usdcBefore;
            // A redemption that burns shares and pays nothing must not be minuted as a withdrawal.
            if (credited == 0) revert VenueRedeemedNothing(burned);
            deployedShares -= burned;
            positionClosed = deployedShares == 0;
            emit VenueRedeemed(decisionId, burned, credited, amount);
        }

        // Position fully unwound ⇒ retire the basis; whatever it exceeds `credited` by is a
        // realised loss, not a residual claim. Otherwise mirror `replay.ts`'s clamp exactly.
        deployedBalance = positionClosed ? 0 : (deployedBalance >= credited ? deployedBalance - credited : 0);
        companyBalance += credited;
        emit DecisionExecuted(decisionId, 1, credited, forecastHash);
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
    function revoke() external onlyOwner {
        revoked = true;
        emit Revoked(msg.sender);
    }

    /// @notice Owner re-hires the agent.
    function reinstate() external onlyOwner {
        revoked = false;
        emit Reinstated(msg.sender);
    }

    /// @notice Owner points the deployed leg at a yield venue, or unsets it with `address(0)`.
    /// @dev Refuses while a position is open, so shares can never be stranded by a re-point; and
    /// refuses a venue whose `asset()` is not this mandate's USDC, which is the cheap way to catch
    /// a wrong address before it holds money. This adds no trust: the owner can already take every
    /// base unit via {emergencyWithdrawAll}.
    function setVenue(address venue_) external onlyOwner {
        if (deployedShares != 0) revert VenueBusy(deployedShares);
        address shareToken = address(0);
        if (venue_ != address(0)) {
            address venueAsset = IYieldVenue(venue_).asset();
            if (venueAsset != usdc) revert VenueAssetMismatch(venueAsset, usdc);
            shareToken = IYieldVenue(venue_).share();
            if (shareToken == address(0)) revert VenueAssetMismatch(address(0), usdc);
        }
        venue = venue_;
        venueShare = shareToken;
        emit VenueChanged(venue_, shareToken);
    }

    /// @notice Owner recovers a non-USDC token — chiefly venue shares stranded by a failed
    /// {emergencyWithdrawAll}.
    /// @dev USDC is REFUSED. The verifier reconstructs `companyBalance` from events; a USDC exit
    /// through a path it cannot see would leave it believing the treasury is richer than it is,
    /// which is exactly the state in which a floor breach goes unreported. The owner's visible
    /// exit is {emergencyWithdrawAll}.
    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        if (token == usdc) revert CannotRescueUsdc();
        if (to == address(0)) revert InvalidRecipient();
        (bool ok, bytes memory ret) =
            token.call(abi.encodeWithSelector(IERC20Minimal.transfer.selector, to, amount));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
        emit TokenRescued(token, to, amount);
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    /// @notice USDC this contract can actually reach right now (6-dec). On Arc this equals
    /// `address(this).balance / SCALE` — one balance, two views.
    function liquidUsdc() external view returns (uint256) {
        return _liquidUsdc();
    }

    // ─── Internals ───────────────────────────────────────────────────────────

    function _liquidUsdc() private view returns (uint256) {
        return IERC20Minimal(usdc).balanceOf(address(this));
    }

    /// @dev Shares to burn to realise `assets`.
    ///
    /// A full unwind takes the WHOLE position — that is the only way an accrued gain is ever
    /// realisable, since cost-basis sizing would leave it behind as unreachable residual shares.
    /// Otherwise: ask the venue (low-level `staticcall`, so a venue lacking `previewWithdraw`
    /// degrades instead of reverting), else pro-rate the position against cost basis, rounding UP
    /// so a rounding error never under-delivers. Always capped by what is actually held — that cap
    /// is the partial-redeem path.
    function _sharesFor(address v, uint256 assets) private view returns (uint256 shares) {
        if (assets >= deployedBalance) return deployedShares;

        (bool ok, bytes memory ret) =
            v.staticcall(abi.encodeWithSelector(IYieldVenue.previewWithdraw.selector, assets));
        if (ok && ret.length >= 32) shares = abi.decode(ret, (uint256));

        if (shares == 0) {
            uint256 basis = deployedBalance;
            shares = basis == 0 ? deployedShares : (deployedShares * assets + basis - 1) / basis;
        }
        if (shares > deployedShares) shares = deployedShares;
        // Never call redeem(0): the venue would burn nothing and pay nothing.
        if (shares == 0) shares = deployedShares;
    }

    /// @dev `approve` on Arc's USDC precompile returns bool; tolerate a venue-side token that
    /// returns nothing. Always 0 → amount → 0, so the non-zero-to-non-zero approval race is moot.
    function _approveUsdc(address spender, uint256 value) private {
        (bool ok, bytes memory ret) =
            usdc.call(abi.encodeWithSelector(IERC20Minimal.approve.selector, spender, value));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
    }

    /// @dev Pays USDC out through the ERC-20 interface rather than a native send. On Arc these move
    /// the same balance, and the ERC-20 form is what lets a recipient contract without `receive()`
    /// be paid — verified on-chain. Sub-1e-6 native dust is not representable at 6 decimals and
    /// stays behind; `fundCompany` rejects non-SCALE-multiple value so this contract never creates
    /// any itself.
    function _sendUsdc(address to, uint256 amount) private {
        (bool ok, bytes memory ret) =
            usdc.call(abi.encodeWithSelector(IERC20Minimal.transfer.selector, to, amount));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
    }
}
