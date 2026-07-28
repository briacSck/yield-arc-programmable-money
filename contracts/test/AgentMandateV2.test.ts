import { expect } from 'chai';
import { network } from 'hardhat';

/**
 * AgentMandateV2 — the venue-aware mandate.
 *
 * Part 1 MIRRORS `AgentMandate.test.ts` case for case. That is the point: v2 is deployed ALONGSIDE
 * the frozen v1 and must still satisfy the five invariants the verifier replays (floor, per-ticket
 * cap, 24h tumbling window, post-revocation asymmetry, decision receipts). If a v1 case would fail
 * here, v2 is not the same instrument.
 *
 * Part 2 covers what v1 could not have: a real yield venue behind the deployed leg — subscription,
 * partial redemption, NAV drift in both directions, a venue that reverts, a venue that lies by
 * moving nothing, revoke-then-withdraw, and an owner exit that survives a stuck venue.
 *
 * ARC FIDELITY, stated up front. On Arc, USDC is the native gas token and the ERC-20 interface at
 * `0x3600…0000` is a SECOND VIEW OF THE SAME BALANCE — verified read-only against Arc testnet
 * (`USDC.balanceOf(<v1 mandate>) == address(<v1 mandate>).balance / 1e12`, a contract can approve
 * and transfer its own balance there, and an ERC-20 transfer INTO a contract with no `receive()`
 * succeeds where a plain native send reverts). No EVM contract can reproduce that duality, because
 * nothing inside the EVM can pull another account's native value. So `fundCompany` (18-dec
 * `msg.value`) and the mock's 6-dec ledger are mirrored EXPLICITLY by `fund()` below, where Arc
 * mirrors them automatically. Everything else — approvals, the venue pull, share accounting, the
 * payout — is exercised for real.
 *
 * UNITS: pools are 6-dec USDC base units; native value = pool × SCALE.
 */
describe('AgentMandateV2', () => {
  const FLOOR = 20_000n;
  const MAX_TICKET = 10_000n;
  const DAILY_CAP = 25_000n;
  const SCALE = 10n ** 12n;
  const DAY = 24 * 60 * 60;
  const PAR = 1_000_000n; // MockYieldVenue price: 1e6 == 1.000000 USDC per share

  async function deployFixture() {
    const { ethers } = await network.connect();
    const [owner, agent, stranger] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory('MockERC20');
    const usdc = await MockERC20.deploy('Arc USDC (mock)', 'USDC');
    const share = await MockERC20.deploy('Mock Fund Share', 'MFS');
    const usdcAddr = await usdc.getAddress();

    const MockYieldVenue = await ethers.getContractFactory('MockYieldVenue');
    const venue = await MockYieldVenue.deploy(usdcAddr, await share.getAddress());
    const venueAddr = await venue.getAddress();

    const AgentMandateV2 = await ethers.getContractFactory('AgentMandateV2');
    const mandate = await AgentMandateV2.deploy(agent.address, FLOOR, MAX_TICKET, DAILY_CAP, usdcAddr);
    const mandateAddr = await mandate.getAddress();

    const id = (s: string) => ethers.encodeBytes32String(s);
    const FH = ethers.keccak256(ethers.toUtf8Bytes('forecast-snapshot-1'));

    /** Owner funds the company pool. The `mint` is the Arc duality the EVM cannot reproduce. */
    const fund = async (poolUnits: bigint) => {
      const tx = await mandate.connect(owner).fundCompany({ value: poolUnits * SCALE });
      // The mock cannot mirror Arc's native/ERC-20 duality (nothing inside the EVM can pull another
      // account's native value), so the 6-dec side is minted explicitly. See the header note.
      await usdc.mint(mandateAddr, poolUnits);
      // Returned so `expect(fund(...)).to.emit(...)` has a transaction to inspect. Without this the
      // matcher receives undefined and dies destructuring `hash`.
      return tx;
    };
    const warp = async (seconds: number) => {
      await ethers.provider.send('evm_increaseTime', [seconds]);
      await ethers.provider.send('evm_mine', []);
    };
    const useVenue = async () => mandate.connect(owner).setVenue(venueAddr);
    /** Top up the venue so it can pay out more than it took in (a NAV gain has to come from somewhere). */
    const fundVenue = async (units: bigint) => usdc.mint(venueAddr, units);

    return {
      ethers, mandate, mandateAddr, usdc, share, venue, venueAddr,
      owner, agent, stranger, id, FH, fund, warp, useVenue, fundVenue,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PART 1 — v1 parity. Every case below mirrors AgentMandate.test.ts.
  // ══════════════════════════════════════════════════════════════════════════

  describe('v1 parity (venue unset — pure escrow, exactly v1 behaviour)', () => {
    it('sets roles, mandate bounds and usdc at construction; venue starts unset', async () => {
      const { mandate, usdc, owner, agent } = await deployFixture();
      expect(await mandate.owner()).to.equal(owner.address);
      expect(await mandate.agent()).to.equal(agent.address);
      expect(await mandate.usdc()).to.equal(await usdc.getAddress());
      expect(await mandate.floorUsdc()).to.equal(FLOOR);
      expect(await mandate.maxTicketUsdc()).to.equal(MAX_TICKET);
      expect(await mandate.dailyCapUsdc()).to.equal(DAILY_CAP);
      expect(await mandate.revoked()).to.equal(false);
      // Deploy first, permission later: a fresh v2 is verifiable before any venue trusts it.
      expect(await mandate.venue()).to.equal(ethersZero());
      expect(await mandate.venueShare()).to.equal(ethersZero());
      expect(await mandate.deployedShares()).to.equal(0n);
    });

    it('constructor rejects zero/owner agent, zero ticket, ticket above daily cap, zero usdc', async () => {
      const { ethers, usdc, owner, agent } = await deployFixture();
      const usdcAddr = await usdc.getAddress();
      const F = await ethers.getContractFactory('AgentMandateV2');
      await expect(F.deploy(ethers.ZeroAddress, FLOOR, MAX_TICKET, DAILY_CAP, usdcAddr))
        .to.be.revertedWithCustomError(F, 'InvalidConstruction');
      await expect(F.deploy(owner.address, FLOOR, MAX_TICKET, DAILY_CAP, usdcAddr))
        .to.be.revertedWithCustomError(F, 'InvalidConstruction');
      await expect(F.deploy(agent.address, FLOOR, 0n, DAILY_CAP, usdcAddr))
        .to.be.revertedWithCustomError(F, 'InvalidConstruction');
      await expect(F.deploy(agent.address, FLOOR, DAILY_CAP + 1n, DAILY_CAP, usdcAddr))
        .to.be.revertedWithCustomError(F, 'InvalidConstruction');
      await expect(F.deploy(agent.address, FLOOR, MAX_TICKET, DAILY_CAP, ethers.ZeroAddress))
        .to.be.revertedWithCustomError(F, 'InvalidConstruction');
    });

    it('owner can retune the mandate; non-owner cannot', async () => {
      const { mandate, owner, stranger } = await deployFixture();
      await expect(mandate.connect(owner).setMandate(30_000n, 5_000n, 12_000n))
        .to.emit(mandate, 'MandateChanged')
        .withArgs(30_000n, 5_000n, 12_000n);
      expect(await mandate.floorUsdc()).to.equal(30_000n);
      await expect(mandate.connect(stranger).setMandate(1n, 1n, 1n))
        .to.be.revertedWithCustomError(mandate, 'NotOwner');
    });

    it('owner can revoke and reinstate; non-owner cannot', async () => {
      const { mandate, owner, stranger } = await deployFixture();
      await expect(mandate.connect(owner).revoke()).to.emit(mandate, 'Revoked').withArgs(owner.address);
      expect(await mandate.revoked()).to.equal(true);
      await expect(mandate.connect(owner).reinstate()).to.emit(mandate, 'Reinstated').withArgs(owner.address);
      expect(await mandate.revoked()).to.equal(false);
      await expect(mandate.connect(stranger).revoke()).to.be.revertedWithCustomError(mandate, 'NotOwner');
    });

    it('owner funds the company balance: native value / SCALE lands in the 6-dec pool', async () => {
      const { mandate, fund } = await deployFixture();
      await expect(fund(50_000n)).to.emit(mandate, 'CompanyFunded').withArgs(50_000n, 50_000n);
      expect(await mandate.companyBalance()).to.equal(50_000n);
    });

    it('fundCompany rejects zero value and non-SCALE-multiple value (no dust truncation)', async () => {
      const { mandate, owner } = await deployFixture();
      await expect(mandate.connect(owner).fundCompany({ value: 0n }))
        .to.be.revertedWithCustomError(mandate, 'InvalidNativeAmount');
      await expect(mandate.connect(owner).fundCompany({ value: 1_000n * SCALE + 1n }))
        .to.be.revertedWithCustomError(mandate, 'InvalidNativeAmount');
    });

    it('deposit moves company→deployed and emits the DecisionExecuted receipt', async () => {
      const { mandate, agent, id, FH, fund } = await deployFixture();
      await fund(50_000n);
      await expect(mandate.connect(agent).deposit(9_000n, id('d-1'), FH))
        .to.emit(mandate, 'DecisionExecuted')
        .withArgs(id('d-1'), 0, 9_000n, FH);
      expect(await mandate.companyBalance()).to.equal(41_000n);
      expect(await mandate.deployedBalance()).to.equal(9_000n);
    });

    it('deposit REVERTS when it would breach the floor (P0)', async () => {
      const { mandate, agent, id, FH, fund } = await deployFixture();
      await fund(25_000n);
      await expect(mandate.connect(agent).deposit(6_000n, id('d-1'), FH))
        .to.be.revertedWithCustomError(mandate, 'FloorBreach');
    });

    it('deposit with amount > companyBalance reverts FloorBreach, not an arithmetic panic', async () => {
      const { mandate, agent, id, FH, fund } = await deployFixture();
      await fund(25_000n);
      await expect(mandate.connect(agent).deposit(60_000n, id('d-1'), FH))
        .to.be.revertedWithCustomError(mandate, 'FloorBreach');
    });

    it('deposit REVERTS above the per-ticket cap', async () => {
      const { mandate, agent, id, FH, fund } = await deployFixture();
      await fund(60_000n);
      await expect(mandate.connect(agent).deposit(10_001n, id('d-1'), FH))
        .to.be.revertedWithCustomError(mandate, 'TicketCapExceeded');
    });

    it('deposit REVERTS above the 24h budget window; window resets after 24h (2× boundary documented)', async () => {
      const { mandate, agent, id, FH, fund, warp } = await deployFixture();
      await fund(100_000n);
      await mandate.connect(agent).deposit(10_000n, id('d-1'), FH);
      await mandate.connect(agent).deposit(10_000n, id('d-2'), FH); // window used: 20k of 25k
      await expect(mandate.connect(agent).deposit(6_000n, id('d-3'), FH))
        .to.be.revertedWithCustomError(mandate, 'DailyCapExceeded');
      await warp(DAY + 1);
      await expect(mandate.connect(agent).deposit(6_000n, id('d-3'), FH))
        .to.emit(mandate, 'DecisionExecuted');
      expect(await mandate.windowDeployed()).to.equal(6_000n);
    });

    it('deposit is blocked when the mandate is revoked', async () => {
      const { mandate, owner, agent, id, FH, fund } = await deployFixture();
      await fund(50_000n);
      await mandate.connect(owner).revoke();
      await expect(mandate.connect(agent).deposit(1_000n, id('d-1'), FH))
        .to.be.revertedWithCustomError(mandate, 'MandateRevoked');
    });

    it('withdrawToCompany is ALLOWED even when revoked (fail-safe asymmetry)', async () => {
      const { mandate, owner, agent, id, FH, fund } = await deployFixture();
      await fund(50_000n);
      await mandate.connect(agent).deposit(9_000n, id('d-1'), FH);
      await mandate.connect(owner).revoke();
      await expect(mandate.connect(agent).withdrawToCompany(9_000n, id('d-2'), FH))
        .to.emit(mandate, 'DecisionExecuted')
        .withArgs(id('d-2'), 1, 9_000n, FH);
      expect(await mandate.companyBalance()).to.equal(50_000n);
      expect(await mandate.deployedBalance()).to.equal(0n);
    });

    it('withdrawToCompany never applies floor/ticket/daily gates', async () => {
      const { mandate, agent, id, FH, fund, warp } = await deployFixture();
      await fund(100_000n);
      await mandate.connect(agent).deposit(10_000n, id('d-1'), FH);
      await mandate.connect(agent).deposit(10_000n, id('d-2'), FH);
      await warp(DAY + 1);
      await mandate.connect(agent).deposit(5_000n, id('d-3'), FH); // deployed: 25k
      await expect(mandate.connect(agent).withdrawToCompany(25_000n, id('d-4'), FH))
        .to.emit(mandate, 'DecisionExecuted');
      expect(await mandate.deployedBalance()).to.equal(0n);
    });

    it('withdrawToCompany REVERTS when amount exceeds what is deployed', async () => {
      const { mandate, agent, id, FH, fund } = await deployFixture();
      await fund(50_000n);
      await mandate.connect(agent).deposit(5_000n, id('d-1'), FH);
      await expect(mandate.connect(agent).withdrawToCompany(5_001n, id('d-2'), FH))
        .to.be.revertedWithCustomError(mandate, 'InsufficientDeployed');
    });

    it('a reused decisionId REVERTS (idempotency, shared across deposit and withdraw)', async () => {
      const { mandate, agent, id, FH, fund } = await deployFixture();
      await fund(50_000n);
      await mandate.connect(agent).deposit(5_000n, id('d-1'), FH);
      await expect(mandate.connect(agent).deposit(1_000n, id('d-1'), FH))
        .to.be.revertedWithCustomError(mandate, 'DuplicateDecision');
      await expect(mandate.connect(agent).withdrawToCompany(1_000n, id('d-1'), FH))
        .to.be.revertedWithCustomError(mandate, 'DuplicateDecision');
    });

    it('only the agent can deposit/withdraw', async () => {
      const { mandate, stranger, id, FH, fund } = await deployFixture();
      await fund(50_000n);
      await expect(mandate.connect(stranger).deposit(1_000n, id('d-1'), FH))
        .to.be.revertedWithCustomError(mandate, 'NotAgent');
      await expect(mandate.connect(stranger).withdrawToCompany(1_000n, id('d-2'), FH))
        .to.be.revertedWithCustomError(mandate, 'NotAgent');
    });

    it('owner emergencyWithdrawAll sweeps unconditionally; USDC round-trip exact', async () => {
      const { mandate, mandateAddr, usdc, owner, agent, id, FH, fund } = await deployFixture();
      await fund(50_000n);
      await mandate.connect(agent).deposit(9_000n, id('d-1'), FH);
      await mandate.connect(owner).revoke(); // exit works even when revoked

      await expect(mandate.connect(owner).emergencyWithdrawAll())
        .to.emit(mandate, 'EmergencyWithdrawal')
        .withArgs(owner.address, 50_000n);

      // v2 pays out through the ERC-20 interface, not a native send: on Arc that moves the same
      // balance (proven on-chain) AND is the only form a contract without `receive()` can be paid
      // in. Under Hardhat the mirrored native value stays behind — a fixture artefact, not a leak.
      expect(await usdc.balanceOf(owner.address)).to.equal(50_000n);
      expect(await usdc.balanceOf(mandateAddr)).to.equal(0n);
      expect(await mandate.companyBalance()).to.equal(0n);
      expect(await mandate.deployedBalance()).to.equal(0n);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // PART 2 — the venue. What v1 structurally could not do.
  // ══════════════════════════════════════════════════════════════════════════

  describe('venue wiring', () => {
    it('owner wires the venue and its share token; non-owner cannot', async () => {
      const { mandate, share, venueAddr, owner, stranger, useVenue } = await deployFixture();
      await expect(useVenue())
        .to.emit(mandate, 'VenueChanged')
        .withArgs(venueAddr, await share.getAddress());
      expect(await mandate.venue()).to.equal(venueAddr);
      expect(await mandate.venueShare()).to.equal(await share.getAddress());
      await expect(mandate.connect(stranger).setVenue(venueAddr))
        .to.be.revertedWithCustomError(mandate, 'NotOwner');
      // Unset returns the mandate to escrow-only.
      await mandate.connect(owner).setVenue(ethersZero());
      expect(await mandate.venue()).to.equal(ethersZero());
    });

    it('setVenue REJECTS a venue denominated in a different asset', async () => {
      const { ethers, mandate, share, owner } = await deployFixture();
      const MockERC20 = await ethers.getContractFactory('MockERC20');
      const other = await MockERC20.deploy('Other', 'OTH');
      const MockYieldVenue = await ethers.getContractFactory('MockYieldVenue');
      const wrong = await MockYieldVenue.deploy(await other.getAddress(), await share.getAddress());
      await expect(mandate.connect(owner).setVenue(await wrong.getAddress()))
        .to.be.revertedWithCustomError(mandate, 'VenueAssetMismatch');
    });

    it('setVenue REFUSES while a position is open (shares can never be stranded by a re-point)', async () => {
      const { mandate, venueAddr, owner, agent, id, FH, fund, useVenue } = await deployFixture();
      await fund(50_000n);
      await useVenue();
      await mandate.connect(agent).deposit(9_000n, id('d-1'), FH);
      expect(await mandate.deployedShares()).to.equal(9_000n);
      await expect(mandate.connect(owner).setVenue(ethersZero()))
        .to.be.revertedWithCustomError(mandate, 'VenueBusy');
      await expect(mandate.connect(owner).setVenue(venueAddr))
        .to.be.revertedWithCustomError(mandate, 'VenueBusy');
    });
  });

  describe('subscription (deposit → venue)', () => {
    it('deposit subscribes into the venue: USDC leaves, shares arrive, receipt unchanged', async () => {
      const { mandate, mandateAddr, usdc, share, venueAddr, agent, id, FH, fund, useVenue } = await deployFixture();
      await fund(50_000n);
      await useVenue();

      const tx = mandate.connect(agent).deposit(9_000n, id('d-1'), FH);
      await expect(tx).to.emit(mandate, 'VenueSubscribed').withArgs(id('d-1'), 9_000n, 9_000n);
      await expect(tx).to.emit(mandate, 'DecisionExecuted').withArgs(id('d-1'), 0, 9_000n, FH);

      // The USDC really moved — this is the sentence v1 could not say truthfully.
      expect(await usdc.balanceOf(venueAddr)).to.equal(9_000n);
      expect(await usdc.balanceOf(mandateAddr)).to.equal(41_000n);
      expect(await share.balanceOf(mandateAddr)).to.equal(9_000n);
      expect(await mandate.deployedShares()).to.equal(9_000n);
      expect(await mandate.deployedBalance()).to.equal(9_000n); // cost basis
      expect(await mandate.companyBalance()).to.equal(41_000n);
    });

    it('leaves NO standing allowance behind (0 → amount → 0 per ticket)', async () => {
      const { mandate, mandateAddr, usdc, venueAddr, agent, id, FH, fund, useVenue } = await deployFixture();
      await fund(50_000n);
      await useVenue();
      await mandate.connect(agent).deposit(9_000n, id('d-1'), FH);
      expect(await usdc.allowance(mandateAddr, venueAddr)).to.equal(0n);
    });

    it('a subscription haircut is honest: fewer shares for the same basis', async () => {
      const { mandate, share, mandateAddr, venue, agent, id, FH, fund, useVenue } = await deployFixture();
      await fund(50_000n);
      await useVenue();
      await venue.setFeeBps(100n); // 1%
      await mandate.connect(agent).deposit(10_000n, id('d-1'), FH);
      expect(await share.balanceOf(mandateAddr)).to.equal(9_900n);
      expect(await mandate.deployedBalance()).to.equal(10_000n); // basis is what was committed
    });

    it('a venue that reverts fails the WHOLE deposit; the decisionId survives for a retry', async () => {
      const { mandate, venue, agent, id, FH, fund, useVenue } = await deployFixture();
      await fund(50_000n);
      await useVenue();
      await venue.setFailDeposit(true);

      // A reverting venue bubbles its own revert rather than a named error — the deposit is a
      // direct external call, deliberately not wrapped in try/catch, so the whole thing fails and
      // the decisionId is never burned. `.reverted` is deprecated in this matcher version.
      await expect(mandate.connect(agent).deposit(9_000n, id('d-1'), FH)).to.be.revert(ethers);
      expect(await mandate.companyBalance()).to.equal(50_000n); // nothing moved
      expect(await mandate.deployedBalance()).to.equal(0n);
      expect(await mandate.decisionUsed(id('d-1'))).to.equal(false);

      await venue.setFailDeposit(false);
      await expect(mandate.connect(agent).deposit(9_000n, id('d-1'), FH)).to.emit(mandate, 'DecisionExecuted');
    });

    it('a venue that takes the USDC and mints nothing REVERTS (VenueMintedNothing)', async () => {
      const { mandate, venue, agent, id, FH, fund, useVenue } = await deployFixture();
      await fund(50_000n);
      await useVenue();
      await venue.setMintZeroShares(true);
      await expect(mandate.connect(agent).deposit(9_000n, id('d-1'), FH))
        .to.be.revertedWithCustomError(mandate, 'VenueMintedNothing');
      expect(await mandate.companyBalance()).to.equal(50_000n);
    });
  });

  describe('redemption and NAV', () => {
    it('round-trips at par: full unwind returns exactly the basis', async () => {
      const { mandate, mandateAddr, usdc, share, agent, id, FH, fund, useVenue } = await deployFixture();
      await fund(50_000n);
      await useVenue();
      await mandate.connect(agent).deposit(9_000n, id('d-1'), FH);

      const tx = mandate.connect(agent).withdrawToCompany(9_000n, id('d-2'), FH);
      await expect(tx).to.emit(mandate, 'VenueRedeemed').withArgs(id('d-2'), 9_000n, 9_000n, 9_000n);
      await expect(tx).to.emit(mandate, 'DecisionExecuted').withArgs(id('d-2'), 1, 9_000n, FH);

      expect(await mandate.companyBalance()).to.equal(50_000n);
      expect(await mandate.deployedBalance()).to.equal(0n);
      expect(await mandate.deployedShares()).to.equal(0n);
      expect(await share.balanceOf(mandateAddr)).to.equal(0n);
      expect(await usdc.balanceOf(mandateAddr)).to.equal(50_000n);
    });

    it('NAV GAIN: a full unwind realises the gain and the RECEIPT carries it', async () => {
      const { mandate, venue, agent, id, FH, fund, useVenue, fundVenue } = await deployFixture();
      await fund(50_000n);
      await useVenue();
      await mandate.connect(agent).deposit(9_000n, id('d-1'), FH);

      await venue.setPriceE6(PAR + PAR / 10n); // +10% NAV
      await fundVenue(10_000n); // the fund has to hold the assets it owes

      // 9 000 shares × 1.1 = 9 900 USDC. The agent asked for 9 000; 9 900 settled, so 9 900 is the
      // number on the record — the alternative would be silently absorbing 900 into an
      // unobservable pool and reporting a smaller move than actually happened.
      const tx = mandate.connect(agent).withdrawToCompany(9_000n, id('d-2'), FH);
      await expect(tx).to.emit(mandate, 'VenueRedeemed').withArgs(id('d-2'), 9_000n, 9_900n, 9_000n);
      await expect(tx).to.emit(mandate, 'DecisionExecuted').withArgs(id('d-2'), 1, 9_900n, FH);

      expect(await mandate.companyBalance()).to.equal(50_900n); // 41 000 + 9 900
      expect(await mandate.deployedBalance()).to.equal(0n);
      expect(await mandate.deployedShares()).to.equal(0n);
    });

    it('NAV LOSS: a full unwind credits only what arrived and RETIRES the basis', async () => {
      const { mandate, venue, agent, id, FH, fund, useVenue } = await deployFixture();
      await fund(50_000n);
      await useVenue();
      await mandate.connect(agent).deposit(9_000n, id('d-1'), FH);

      await venue.setPriceE6(PAR - PAR / 10n); // −10% NAV

      await expect(mandate.connect(agent).withdrawToCompany(9_000n, id('d-2'), FH))
        .to.emit(mandate, 'DecisionExecuted').withArgs(id('d-2'), 1, 8_100n, FH);

      expect(await mandate.companyBalance()).to.equal(49_100n); // 41 000 + 8 100
      // The 900 shortfall is a REALISED loss. Leaving it in deployedBalance would be a claim on
      // money that no longer exists, and the next withdrawal would credit it out of thin air.
      expect(await mandate.deployedBalance()).to.equal(0n);
      expect(await mandate.deployedShares()).to.equal(0n);
    });

    it('PARTIAL redeem: takes only the shares it needs and leaves the rest invested', async () => {
      const { mandate, share, mandateAddr, agent, id, FH, fund, useVenue, warp } = await deployFixture();
      await fund(100_000n);
      await useVenue();
      await mandate.connect(agent).deposit(10_000n, id('d-1'), FH);
      await mandate.connect(agent).deposit(10_000n, id('d-2'), FH); // basis 20 000, shares 20 000

      await warp(1);
      await expect(mandate.connect(agent).withdrawToCompany(5_000n, id('d-3'), FH))
        .to.emit(mandate, 'VenueRedeemed').withArgs(id('d-3'), 5_000n, 5_000n, 5_000n);

      expect(await mandate.deployedBalance()).to.equal(15_000n);
      expect(await mandate.deployedShares()).to.equal(15_000n);
      expect(await share.balanceOf(mandateAddr)).to.equal(15_000n);
    });

    it('PARTIAL redeem capped by the position: a deep loss pays what exists, not what was asked', async () => {
      const { mandate, venue, agent, id, FH, fund, useVenue } = await deployFixture();
      await fund(100_000n);
      await useVenue();
      await mandate.connect(agent).deposit(10_000n, id('d-1'), FH);
      await mandate.connect(agent).deposit(10_000n, id('d-2'), FH); // basis 20 000, shares 20 000

      await venue.setPriceE6(PAR / 5n); // −80% NAV: 5 000 USDC would need 25 000 shares, only 20 000 exist

      const tx = mandate.connect(agent).withdrawToCompany(5_000n, id('d-3'), FH);
      await expect(tx).to.emit(mandate, 'VenueRedeemed').withArgs(id('d-3'), 20_000n, 4_000n, 5_000n);
      await expect(tx).to.emit(mandate, 'DecisionExecuted').withArgs(id('d-3'), 1, 4_000n, FH);

      expect(await mandate.deployedShares()).to.equal(0n);
      expect(await mandate.deployedBalance()).to.equal(0n);
    });

    it('falls back to pro-rata share sizing when the venue cannot preview a withdrawal', async () => {
      const { mandate, venue, agent, id, FH, fund, useVenue } = await deployFixture();
      await fund(100_000n);
      await useVenue();
      await mandate.connect(agent).deposit(10_000n, id('d-1'), FH);
      await mandate.connect(agent).deposit(10_000n, id('d-2'), FH);

      await venue.setBreakPreviewWithdraw(true); // previewWithdraw() reverts

      await expect(mandate.connect(agent).withdrawToCompany(5_000n, id('d-3'), FH))
        .to.emit(mandate, 'VenueRedeemed').withArgs(id('d-3'), 5_000n, 5_000n, 5_000n);
      expect(await mandate.deployedShares()).to.equal(15_000n);
    });

    it('a venue that will not redeem REVERTS the withdrawal; state and decisionId survive the retry', async () => {
      const { mandate, venue, agent, id, FH, fund, useVenue } = await deployFixture();
      await fund(50_000n);
      await useVenue();
      await mandate.connect(agent).deposit(9_000n, id('d-1'), FH);
      await venue.setFailRedeem(true);

      await expect(mandate.connect(agent).withdrawToCompany(9_000n, id('d-2'), FH))
        .to.be.revertedWithCustomError(mandate, 'VenueRedeemFailed');
      expect(await mandate.companyBalance()).to.equal(41_000n);
      expect(await mandate.deployedShares()).to.equal(9_000n);
      expect(await mandate.decisionUsed(id('d-2'))).to.equal(false);

      await venue.setFailRedeem(false);
      await expect(mandate.connect(agent).withdrawToCompany(9_000n, id('d-2'), FH))
        .to.emit(mandate, 'DecisionExecuted');
    });

    it('a venue that burns shares and pays nothing REVERTS (VenueRedeemedNothing)', async () => {
      const { mandate, venue, agent, id, FH, fund, useVenue } = await deployFixture();
      await fund(50_000n);
      await useVenue();
      await mandate.connect(agent).deposit(9_000n, id('d-1'), FH);
      await venue.setPayZeroAssets(true);

      await expect(mandate.connect(agent).withdrawToCompany(9_000n, id('d-2'), FH))
        .to.be.revertedWithCustomError(mandate, 'VenueRedeemedNothing');
      expect(await mandate.deployedShares()).to.equal(9_000n); // nothing lost
    });

    it('REVOKE THEN WITHDRAW still unwinds the venue — the asymmetry survives the venue', async () => {
      const { mandate, mandateAddr, usdc, owner, agent, id, FH, fund, useVenue } = await deployFixture();
      await fund(50_000n);
      await useVenue();
      await mandate.connect(agent).deposit(9_000n, id('d-1'), FH);
      await mandate.connect(owner).revoke();

      // Deposits are dead; the exit ramp is not.
      await expect(mandate.connect(agent).deposit(1_000n, id('d-x'), FH))
        .to.be.revertedWithCustomError(mandate, 'MandateRevoked');
      await expect(mandate.connect(agent).withdrawToCompany(9_000n, id('d-2'), FH))
        .to.emit(mandate, 'DecisionExecuted').withArgs(id('d-2'), 1, 9_000n, FH);

      expect(await usdc.balanceOf(mandateAddr)).to.equal(50_000n);
      expect(await mandate.deployedShares()).to.equal(0n);
    });
  });

  describe('emergency exit', () => {
    it('unwinds the venue and sweeps everything to the owner', async () => {
      const { mandate, mandateAddr, usdc, owner, agent, id, FH, fund, useVenue } = await deployFixture();
      await fund(50_000n);
      await useVenue();
      await mandate.connect(agent).deposit(9_000n, id('d-1'), FH);

      await expect(mandate.connect(owner).emergencyWithdrawAll())
        .to.emit(mandate, 'EmergencyWithdrawal').withArgs(owner.address, 50_000n);

      expect(await usdc.balanceOf(owner.address)).to.equal(50_000n);
      expect(await usdc.balanceOf(mandateAddr)).to.equal(0n);
      expect(await mandate.deployedShares()).to.equal(0n);
    });

    it('STILL EXITS when the venue is stuck: sweeps what is reachable, shares recovered by rescueToken', async () => {
      const { mandate, mandateAddr, usdc, share, venue, owner, agent, id, FH, fund, useVenue } = await deployFixture();
      await fund(50_000n);
      await useVenue();
      await mandate.connect(agent).deposit(9_000n, id('d-1'), FH);
      await venue.setFailRedeem(true); // the fund is frozen

      const tx = mandate.connect(owner).emergencyWithdrawAll();
      await expect(tx).to.emit(mandate, 'VenueExitFailed').withArgs(9_000n);
      await expect(tx).to.emit(mandate, 'EmergencyWithdrawal').withArgs(owner.address, 41_000n);

      // The owner gets every base unit the contract can actually reach. The 9 000 in the frozen
      // fund is stuck in the FUND, not in the mandate — no contract design can conjure it back.
      expect(await usdc.balanceOf(owner.address)).to.equal(41_000n);
      expect(await usdc.balanceOf(mandateAddr)).to.equal(0n);
      expect(await mandate.companyBalance()).to.equal(0n);
      expect(await mandate.deployedBalance()).to.equal(0n);
      expect(await mandate.deployedShares()).to.equal(9_000n); // the claim survives

      // The share certificate is recoverable, so the owner can redeem directly once the fund thaws.
      await expect(mandate.connect(owner).rescueToken(await share.getAddress(), owner.address, 9_000n))
        .to.emit(mandate, 'TokenRescued');
      expect(await share.balanceOf(owner.address)).to.equal(9_000n);
    });

    it('rescueToken REFUSES USDC — an invisible exit would blind the verifier', async () => {
      const { mandate, usdc, owner } = await deployFixture();
      await expect(mandate.connect(owner).rescueToken(await usdc.getAddress(), owner.address, 1n))
        .to.be.revertedWithCustomError(mandate, 'CannotRescueUsdc');
    });

    it('rescueToken is owner-only and refuses the zero recipient', async () => {
      const { mandate, share, owner, stranger } = await deployFixture();
      const shareAddr = await share.getAddress();
      await expect(mandate.connect(stranger).rescueToken(shareAddr, stranger.address, 1n))
        .to.be.revertedWithCustomError(mandate, 'NotOwner');
      await expect(mandate.connect(owner).rescueToken(shareAddr, ethersZero(), 1n))
        .to.be.revertedWithCustomError(mandate, 'InvalidRecipient');
    });
  });

  describe('verifier agreement', () => {
    it('companyBalance is EXACTLY reconstructible from the six events, across a NAV gain', async () => {
      // This is the property the whole accounting design exists to protect. `replay.ts` rebuilds
      // companyBalance from CompanyFunded.amount and DecisionExecuted.amount and checks the FLOOR
      // against that reconstruction — so a single base unit credited outside those events would
      // make the verifier report breaches that never happened.
      const { mandate, venue, agent, id, FH, fund, useVenue, fundVenue } = await deployFixture();
      await fund(50_000n);
      await useVenue();
      await mandate.connect(agent).deposit(9_000n, id('d-1'), FH);
      await venue.setPriceE6(PAR + PAR / 20n); // +5%
      await fundVenue(10_000n);
      await mandate.connect(agent).withdrawToCompany(9_000n, id('d-2'), FH);
      await mandate.connect(agent).deposit(4_000n, id('d-3'), FH);

      const funded = await mandate.queryFilter(mandate.filters.CompanyFunded());
      const moves = await mandate.queryFilter(mandate.filters.DecisionExecuted());
      let replayed = 0n;
      for (const e of funded) replayed += BigInt(e.args.amount);
      for (const e of moves) {
        replayed += Number(e.args.kind) === 0 ? -BigInt(e.args.amount) : BigInt(e.args.amount);
      }

      expect(replayed).to.equal(await mandate.companyBalance());
    });

    it('every DecisionExecuted receipt keeps v1 shape: indexed id, kind, amount, forecastHash', async () => {
      const { mandate, agent, id, FH, fund, useVenue } = await deployFixture();
      await fund(50_000n);
      await useVenue();
      await mandate.connect(agent).deposit(9_000n, id('d-1'), FH);
      await mandate.connect(agent).withdrawToCompany(9_000n, id('d-2'), FH);

      const moves = await mandate.queryFilter(mandate.filters.DecisionExecuted());
      expect(moves).to.have.length(2);
      expect(Number(moves[0]!.args.kind)).to.equal(0);
      expect(Number(moves[1]!.args.kind)).to.equal(1);
      for (const m of moves) expect(m.args.forecastHash).to.equal(FH);
      // The id is indexed, so a verifier can filter on it without decoding data.
      expect(moves[0]!.topics[1]).to.equal(id('d-1'));
    });
  });
});

/** ethers' zero address without threading `ethers` through every assertion. */
function ethersZero(): string {
  return '0x0000000000000000000000000000000000000000';
}
