// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SweepEscrow
/// @notice Minimal escrow enforcing a per-account minimum-balance covenant on Arc.
/// @dev USDC is Arc's native gas token (per docs.arc.io — Stable Fee Design), so balances
/// here are native currency (msg.value), not an ERC20 transfer — depositing IS sending
/// USDC, the same way depositing ETH works natively on Ethereum. This is the contract
/// behind the "code-enforced, not promised" pitch: release() cannot drop an account's
/// balance below its covenant, full stop, regardless of what the off-chain backend asks
/// for (see /plan-eng-review, 2026-06-18, and the design doc's real-economy mapping —
/// this covenant is the on-chain form of TreasurySettings.minimumBalance in yield-backend).
///
/// Per-account model: every YIELD user is a distinct `account`, identified by an on-chain
/// address. The owner (YIELD's operator key) orchestrates deposit/release on behalf of
/// named accounts — this is the testnet DEMO shape. The non-custodial production version
/// (each account signs its own deposit/release with its own wallet, no onlyOwner) is
/// TODO-13 in docs/architecture.md; keeping that distinction explicit so the demo never
/// overclaims to be the non-custodial end state.
contract SweepEscrow {
    address public owner;

    mapping(address => uint256) public balances;
    mapping(address => uint256) public minimumBalance;

    event Deposited(address indexed account, uint256 amount, uint256 newBalance);
    event Released(address indexed account, uint256 amount, uint256 newBalance);
    event CovenantSet(address indexed account, uint256 minimumBalance);

    error NotOwner();
    error CovenantViolation(uint256 requested, uint256 balanceAfter, uint256 minimumRequired);
    error InsufficientBalance(uint256 requested, uint256 available);
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /// @notice Sets the minimum-balance covenant for an account. Admin-only — called once
    /// when a user configures their YIELD treasury settings (mirrors
    /// TreasurySettings.minimumBalance in yield-backend).
    function setCovenant(address account, uint256 minimumBalanceAmount) external onlyOwner {
        minimumBalance[account] = minimumBalanceAmount;
        emit CovenantSet(account, minimumBalanceAmount);
    }

    /// @notice Deposit native currency (USDC, Arc's native gas token) into `account`'s escrow
    /// balance. DEMO: owner-orchestrated — the operator key funds the deposit on behalf of the
    /// named account. Non-custodial production has the account deposit for itself (TODO-13).
    function deposit(address account) external payable onlyOwner {
        balances[account] += msg.value;
        emit Deposited(account, msg.value, balances[account]);
    }

    /// @notice Release `amount` from `account`'s escrow back to `account`. Reverts if the
    /// balance remaining after release would drop below the account's covenant — this is the
    /// enforcement the entire pitch rests on. DEMO: owner-orchestrated (TODO-13 for
    /// non-custodial).
    function release(address account, uint256 amount) external onlyOwner {
        uint256 balance = balances[account];
        if (amount > balance) revert InsufficientBalance(amount, balance);

        uint256 balanceAfter = balance - amount;
        uint256 covenant = minimumBalance[account];
        if (balanceAfter < covenant) {
            revert CovenantViolation(amount, balanceAfter, covenant);
        }

        balances[account] = balanceAfter;
        emit Released(account, amount, balanceAfter);

        (bool sent, ) = account.call{value: amount}('');
        if (!sent) revert TransferFailed();
    }
}
