// Contracts
const CONTRACTS = {
  vault: "0xB91AE2c8365FD45030abA84a4666C4dB074E53E7",
  sir: "0x1278B112943Abc025a0DF081Ee42369414c3A834",
  apeImplementation: "0x8E3a5ec5a8B23Fd169F38C9788B19e72aEd97b5A",
};

let provider;

// Initialize when loaded
window.addEventListener("load", () => {
  document.getElementById("connect").addEventListener("click", connectWallet);
});

async function connectWallet() {
  try {
    provider = new ethers.BrowserProvider(window.ethereum);
    showLoading(true, "Awaiting wallet connection...");
    await provider.send("eth_requestAccounts", []);
    const signer = await provider.getSigner();
    scanPositions(await signer.getAddress());
  } catch (error) {
    if (!isUserRejected(error)) {
      showError(`Connection failed: ${error.message}`);
    }
  }
}

async function scanPositions(address) {
  try {
    showLoading(true, "Initializing scan...");

    const results = {
      tea: [],
      ape: [],
      sir: {
        stakedLocked: 0n,
        stakedUnlocked: 0n,
        dividends: 0n,
        lper: [],
        contributor: 0n,
      },
    };

    // Get contracts
    const vault = new ethers.Contract(
      CONTRACTS.vault,
      [
        "function paramsById(uint48) view returns (tuple(address,address,int8))",
        "function numberOfVaults() view returns (uint48)",
        "function balanceOf(address,uint) view returns (uint)",
        "function unclaimedRewards(uint,address) view returns (uint80)",
        "function uri(uint) view returns (string)",
      ],
      provider
    );

    const sir = new ethers.Contract(
      CONTRACTS.sir,
      [
        "function contributorUnclaimedSIR(address) view returns (uint80)",
        "function stakeOf(address) view returns (tuple(uint80,uint80))",
        "function unclaimedDividends(address) view returns (uint96)",
      ],
      provider
    );

    // Scan vaults
    const numVaults = await vault.numberOfVaults();
    showLoading(true, `Found ${numVaults} vaults to scan`);

    for (let vaultId = 1n; vaultId <= numVaults; vaultId++) {
      showLoading(true, `Scanning Vault ${vaultId}`);
      const params = await vault.paramsById(vaultId);

      // TEA Balance (ERC1155)
      showLoading(true, `Checking TEA balance in Vault ${vaultId}`);
      const teaBalance = await vault.balanceOf(address, vaultId);
      if (teaBalance > 0n) {
        results.tea.push({
          vaultId: Number(vaultId),
          params,
          balance: teaBalance,
          decimals: await getDecimalsTEA(vault, vaultId),
        });
      }
      console.log("TEA Balance for Vault", Number(vaultId), "is", teaBalance);

      // APE Balance (ERC20)
      showLoading(true, `Checking APE balance in Vault ${vaultId}`);
      const apeAddress = calculateApeAddress(vaultId);
      console.log("APE address for Vault", Number(vaultId), "is", apeAddress);
      const [apeBalance, apeDecimals] = await getERC20Balance(
        apeAddress,
        address
      );
      if (apeBalance > 0n) {
        results.ape.push({
          vaultId: Number(vaultId),
          params,
          balance: apeBalance,
          decimals: Number(apeDecimals),
        });
      }
      console.log("APE Balance for Vault", Number(vaultId), "is", apeBalance);

      // SIR LP rewards
      showLoading(true, `Checking SIR LP rewards in Vault ${vaultId}`);
      const lperRewards = await vault.unclaimedRewards(vaultId, address);
      results.sir.lper.push({
        vaultId: Number(vaultId),
        rewards: lperRewards,
      });
      // results.sir.lper[Number(vaultId)] = lperRewards; // Store by vaultId
      console.log("LP rewards for Vault", Number(vaultId), "is", lperRewards);
    }

    // SIR positions
    showLoading(true, "Checking SIR positions...");
    results.sir.contributor = await sir.contributorUnclaimedSIR(address);
    console.log(
      "SIR contributor unclaimed rewards are",
      results.sir.contributor
    );
    const [unlocked, locked] = await sir.stakeOf(address);
    results.sir.stakedLocked = locked;
    results.sir.stakedUnlocked = unlocked;
    results.sir.dividends = await sir.unclaimedDividends(address);

    displayResults(results);
  } catch (error) {
    showError(`Scan failed: ${error.message}`);
  } finally {
    showLoading(false);
  }
}

// Deterministic APE address calculation
function calculateApeAddress(vaultId) {
  // Using ClonesWithImmutableArgs pattern
  const create2ProxyBytecodeHash =
    "0x21c35dbe1b344a2488cf3321d6ce542f8e9f305544ff09e4993a62319a497c1f";

  // Convert vaultId to 32-byte hex string
  const salt = ethers.toBeHex(vaultId, 32);

  // Calculate proxy address (CREATE2)
  const proxyAddress = ethers.getCreate2Address(
    CONTRACTS.vault, // Deployer address
    salt, // vaultId as salt
    create2ProxyBytecodeHash
  );

  // Calculate final CREATE3 address (RLP encoding)
  const rlpEncoded = ethers.concat([
    "0xd6", // RLP header (0xc0 + 0x16)
    "0x94", // Proxy address prefix (0x80 + 0x14)
    proxyAddress,
    "0x01", // Nonce
  ]);

  return ethers.dataSlice(ethers.keccak256(rlpEncoded), 12, 32);
}

async function getDecimalsTEA(vault, vaultId) {
  const uri = await vault.uri(vaultId);
  const encodedJson = uri.split(",")[1];
  const decodedJson = decodeURIComponent(encodedJson);
  const { decimals } = JSON.parse(decodedJson);
  return decimals;
}

async function getERC20Balance(tokenAddress, userAddress) {
  const contract = new ethers.Contract(
    tokenAddress,
    [
      "function balanceOf(address) view returns (uint)",
      "function decimals() view returns (uint8)",
    ],
    provider
  );
  return [await contract.balanceOf(userAddress), await contract.decimals()];
}

function displayResults(results) {
  const container = document.getElementById("results");
  container.innerHTML = `
        <h3>Your Positions</h3>
        ${renderSection("TEA", results.tea)}
        ${renderSection("APE", results.ape)}
        ${renderSirResults(results.sir)}
    `;
}

function renderSection(type, items) {
  if (!items.length) return "";
  return `
        <h4>${type} Positions</h4>
        ${items
          .map(
            (item) => `
              <button onclick="handleBurn(
               '${ethers.getAddress(
                 item.params[0]
               )}', // Convert to checksum address
              '${ethers.getAddress(
                item.params[1]
              )}', // Convert to checksum address
              ${Number(item.params[2])}, // Convert to number
              '${type}', 
              '${item.balance.toString()}' // Pass as string
            )">
                    Burn ${ethers.formatUnits(
                      item.balance,
                      item.decimals
                    )} ${type}-${item.vaultId}
              </button>
            `
          )
          .join("<br>")}
    `;
}
function renderSirResults(sir) {
  return `
    <h4>SIR Positions</h4>
        <button disabled>${ethers.formatUnits(
          sir.stakedLocked,
          12
        )} Locked SIR</button>
        <br>
        ${
          sir.stakedUnlocked > 0n
            ? `
            <button onclick="handleUnstake('${sir.stakedUnlocked.toString()}')">
                Unstake ${ethers.formatUnits(
                  sir.stakedUnlocked,
                  12
                )} Unlocked SIR
            </button><br>
            `
            : ""
        }
        ${
          sir.dividends > 0n
            ? `
            <button onclick="handleClaimDividends()">
                Withdraw ${ethers.formatUnits(sir.dividends, 18)} ETH dividends
            </button><br>
            `
            : ""
        }
        ${sir.lper
          .map((lp) =>
            lp.rewards > 0n
              ? `
                <button onclick="handleClaimLpRewards(${lp.vaultId})">
                    Claim ${ethers.formatUnits(
                      lp.rewards,
                      12
                    )} SIR from Vault-${lp.vaultId}
                </button><br>
              `
              : ""
          )
          .join("")}
        ${
          sir.contributor > 0n
            ? `
                <button onclick="handleClaimContributor()">
                    Claim ${ethers.formatUnits(
                      sir.contributor,
                      12
                    )} SIR as Contributor
                </button><br>
            `
            : ""
        }
    `;
}

// Transaction handlers
async function handleBurn(
  debtToken,
  collateralToken,
  leverageTier,
  tokenType,
  amount
) {
  try {
    const signer = await provider.getSigner();
    const vault = new ethers.Contract(
      CONTRACTS.vault,
      [
        "function burn(bool, (address,address,int8), uint256) returns (uint144)",
      ],
      signer
    );

    console.log("About to Burn!");
    const tx = await vault.burn(
      tokenType === "APE", // isAPE boolean
      [debtToken, collateralToken, leverageTier],
      amount
    );

    await tx.wait();
    alert("Burn successful!");
  } catch (error) {
    if (!isUserRejected(error)) {
      showError(`Burn failed: ${error.message}`);
    }
  }
}

async function handleClaimLpRewards(vaultId) {
  try {
    const signer = await provider.getSigner();
    const sir = new ethers.Contract(
      CONTRACTS.sir,
      ["function lPerMint(uint256 vaultId) returns (uint80)"],
      signer
    );

    const tx = await sir.lPerMint(vaultId);
    await tx.wait();
    alert("LP rewards claimed!");
  } catch (error) {
    if (!isUserRejected(error)) {
      showError(`Claim failed: ${error.message}`);
    }
  }
}

async function handleClaimContributor() {
  try {
    const signer = await provider.getSigner();
    const sir = new ethers.Contract(
      CONTRACTS.sir,
      ["function contributorMint() returns (uint80)"],
      signer
    );

    const tx = await sir.contributorMint();
    await tx.wait();
    alert("Contributor rewards claimed!");
  } catch (error) {
    if (!isUserRejected(error)) {
      showError(`Claim failed: ${error.message}`);
    }
  }
}

async function handleUnstake(amount) {
  try {
    const signer = await provider.getSigner();
    const sir = new ethers.Contract(
      CONTRACTS.sir,
      ["function unstake(uint80 amount)"],
      signer
    );

    const tx = await sir.unstake(amount);
    await tx.wait();
    alert("Unstake successful!");
  } catch (error) {
    if (!isUserRejected(error)) {
      showError(`Unstake failed: ${error.message}`);
    }
  }
}

async function handleClaimDividends() {
  try {
    const signer = await provider.getSigner();
    const sir = new ethers.Contract(
      CONTRACTS.sir,
      ["function claim() returns (uint96)"],
      signer
    );

    const tx = await sir.claim();
    await tx.wait();
    alert("Dividends claimed!");
  } catch (error) {
    if (!isUserRejected(error)) {
      showError(`Claim failed: ${error.message}`);
    }
  }
}

function isUserRejected(error) {
  return (
    error.code === "ACTION_REJECTED" ||
    error.code === 4001 ||
    error.message.includes("user rejected") ||
    error.message.includes("request rejected")
  );
}

function showError(message) {
  const container = document.getElementById("results");
  container.innerHTML = `<div style="color: red">${message}</div>`;
}

function showLoading(show, message = "") {
  const loading = document.getElementById("loading");
  const status = document.getElementById("scanning-status");

  if (show) {
    loading.style.display = "block";
    status.textContent = message;
  } else {
    loading.style.display = "none";
    status.textContent = "";
  }
}
