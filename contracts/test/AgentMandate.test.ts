import { expect } from 'chai';
import { network } from 'hardhat';

/**
 * AgentMandate — contract testing bar, plan §17.7 + the /autoplan eng-review additions:
 * underflow-vs-FloorBreach, 24h window boundary, constructor validation, native↔6-dec round-trip,
 * CEI on the emergency path. UNITS: pools are 6-dec USDC base units; native value = pool × SCALE.
 */
describe('AgentMandate', () => {
  const FLOOR = 20_000n;
  const MAX_TICKET = 10_000n;
  const DAILY_CAP = 25_000n;
  const SCALE = 10n ** 12n;
  const DAY = 24 * 60 * 60;

  async function deployFixture() {
    const { ethers } = await network.connect();
    const [owner, agent, stranger] = await ethers.getSigners();
    const AgentMandate = await ethers.getContractFactory('AgentMandate');
    const mandate = await AgentMandate.deploy(agent.address, FLOOR, MAX_TICKET, DAILY_CAP);
    const id = (s: string) => ethers.encodeBytes32String(s);
    const FH = ethers.keccak256(ethers.toUtf8Bytes('forecast-snapshot-1'));
    const fund = async (poolUnits: bigint) =>
      mandate.connect(owner).fundCompany({ value: poolUnits * SCALE });
    const warp = async (seconds: number) => {
      await ethers.provider.send('evm_increaseTime', [seconds]);
      await ethers.provider.send('evm_mine', []);
    };
    return { ethers, mandate, owner, agent, stranger, id, FH, fund, warp };
  }

  // ── Roles & mandate config ────────────────────────────────────────────────

  it('sets roles and mandate bounds at construction', async () => {
    const { mandate, owner, agent } = await deployFixture();
    expect(await mandate.owner()).to.equal(owner.address);
    expect(await mandate.agent()).to.equal(agent.address);
    expect(await mandate.floorUsdc()).to.equal(FLOOR);
    expect(await mandate.maxTicketUsdc()).to.equal(MAX_TICKET);
    expect(await mandate.dailyCapUsdc()).to.equal(DAILY_CAP);
    expect(await mandate.revoked()).to.equal(false);
  });

  it('constructor rejects zero/owner agent, zero ticket, ticket above daily cap', async () => {
    const { ethers } = await network.connect();
    const [owner, agent] = await ethers.getSigners();
    const AgentMandate = await ethers.getContractFactory('AgentMandate');
    await expect(AgentMandate.deploy(ethers.ZeroAddress, FLOOR, MAX_TICKET, DAILY_CAP))
      .to.be.revertedWithCustomError(AgentMandate, 'InvalidConstruction');
    await expect(AgentMandate.deploy(owner.address, FLOOR, MAX_TICKET, DAILY_CAP))
      .to.be.revertedWithCustomError(AgentMandate, 'InvalidConstruction');
    await expect(AgentMandate.deploy(agent.address, FLOOR, 0n, DAILY_CAP))
      .to.be.revertedWithCustomError(AgentMandate, 'InvalidConstruction');
    await expect(AgentMandate.deploy(agent.address, FLOOR, DAILY_CAP + 1n, DAILY_CAP))
      .to.be.revertedWithCustomError(AgentMandate, 'InvalidConstruction');
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

  // ── Funding (native → 6-dec pool boundary) ────────────────────────────────

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

  // ── deposit: the triple-gated risk-adding move ────────────────────────────

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
    await fund(25_000n); // floor 20k: anything above 5k breaches
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
    await fund(60_000n); // floor headroom 40k, so the ticket gate is what fires
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
    // Fixed budget window, not rolling: a fresh window opens and the full cap is available again.
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

  // ── withdrawToCompany: the ungated risk-reducing move ─────────────────────

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
    // 25k > maxTicket(10k) and > remaining window budget — withdraw ignores both.
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

  // ── Idempotency & access ──────────────────────────────────────────────────

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

  // ── Owner exit (the only external-transfer path — CEI + round-trip) ───────

  it('owner emergencyWithdrawAll sweeps both pools unconditionally, native round-trip exact', async () => {
    const { ethers, mandate, owner, agent, id, FH, fund } = await deployFixture();
    await fund(50_000n);
    await mandate.connect(agent).deposit(9_000n, id('d-1'), FH);
    await mandate.connect(owner).revoke(); // exit works even when revoked

    const before = await ethers.provider.getBalance(owner.address);
    const tx = await mandate.connect(owner).emergencyWithdrawAll();
    const receipt = await tx.wait();
    const gas = receipt!.gasUsed * receipt!.gasPrice;
    const after = await ethers.provider.getBalance(owner.address);

    // Round-trip: 50 000 6-dec units → exactly 50 000 × SCALE native back (minus gas).
    expect(after - before + gas).to.equal(50_000n * SCALE);
    expect(await mandate.companyBalance()).to.equal(0n);
    expect(await mandate.deployedBalance()).to.equal(0n);
    expect(await ethers.provider.getBalance(await mandate.getAddress())).to.equal(0n);
  });
});
