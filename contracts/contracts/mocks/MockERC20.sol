// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MockERC20 — TEST DOUBLE ONLY. Never deployed to Arc.
/// @notice A minimal 6-decimal ERC-20 used by the {AgentMandateV2} Hardhat suite to stand in for
/// (a) Arc's native-USDC ERC-20 interface at `0x3600…0000` and (b) a venue's share token.
///
/// @dev This mock CANNOT reproduce Arc's defining property — that the ERC-20 balance and the
/// account's native balance are one and the same. No EVM contract can: nothing inside the EVM can
/// pull another account's native value, which is exactly what a precompile-backed `transferFrom`
/// does. That property was therefore verified directly against Arc testnet (read-only) rather than
/// in these tests; see the `AgentMandateV2` contract doc. The consequence for the suite is that
/// `fundCompany`'s native inflow and the mock's ERC-20 ledger are mirrored explicitly by the test
/// fixture instead of automatically by the chain.
contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public constant decimals = 6;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory name_, string memory symbol_) {
        name = name_;
        symbol = symbol_;
    }

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function burn(address from, uint256 amount) external {
        require(balanceOf[from] >= amount, "MockERC20: burn exceeds balance");
        balanceOf[from] -= amount;
        totalSupply -= amount;
        emit Transfer(from, address(0), amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= amount, "MockERC20: insufficient allowance");
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) private {
        require(balanceOf[from] >= amount, "MockERC20: insufficient balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}
