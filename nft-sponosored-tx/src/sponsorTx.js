const ethers = require("ethers");
const flashbot = require("@flashbots/ethers-provider-bundle");
require("dotenv").config();

// load required NFT ABI: https://api-goerli.etherscan.io/api?module=contract&action=getabi&address=0xf5de760f2e916647fd766B4AD9E85ff943cE3A2b
const nftABI = require("../abi/nft.json");
// address of the deployed NFT smart-contract
const nftAddress = "0xf5de760f2e916647fd766B4AD9E85ff943cE3A2b";
// unique ID of the NFT we are trying to rescue
const nftID = 95744;

async function main() {
    // goerli network
    const CHAIN_ID = 5;
    // initialize provider 
    const provider = new ethers.providers.AlchemyProvider(CHAIN_ID);
    // initialize exploited wallet with compromised private key (this wallet contains the NFT)
    const exploited = new ethers.Wallet(process.env.EXPLOIT, provider);
    // initialize sponsor wallet which will be used to pay for gas fees (this wallet will receive the NFT)
    const sponsor = new ethers.Wallet(process.env.SPONSOR, provider);
    // initialize the flashbots provider (this will be used to relay the flashbots transaction bundle)
    const flashbotProvider = await flashbot.FlashbotsBundleProvider.create(
        provider,
        sponsor,
        "https://relay-goerli.flashbots.net",
        "goerli"
    );
    // define the NFT contract as an ethers object
    const ERC721 = new ethers.Contract(nftAddress, nftABI, provider);
    /* call the `transferFrom` function of the ERC721 contract
    Recall `transerFrom` has the following parameters: 
        - from (address): the exploited address will be sending the NFT
        - to (address): in this case the sponsor address paying for the NFT transfer gas fees will also receive the NFT
        - tokenId (uint256): the unique tokenId of the NFT we are trying to rescue (ie: 95744)
    */
    const nftTransfer = await ERC721.populateTransaction.transferFrom(
        exploited.address,
        sponsor.address,
        nftID
    );
    // the first transaction will pay for the gas fees of transferring the NFT from the exploited address to the sponsor address
    const tx1 = {
        // goerli testnet
        chainId: CHAIN_ID,
        // EIP-1559 style transaction
        type: 2, 
        // manually specify the amount of ETH to send to the exploited address to pay for gas fees
        value: ethers.utils.parseUnits("0.01", "ether"),
        // the max fee per unit of gas (arbitrarily set)
        maxFeePerGas: ethers.utils.parseUnits("3", "gwei"),
        // the max miner tip to pay (arbitrarily set)
        maxPriorityFeePerGas: ethers.utils.parseUnits("2", "gwei"),
        // the gas limit (arbitrarily set)
        gasLimit: 21000,
        // the ETH must be received by the exploited address so it can pay for the gas fees to transfer the NFT
        to: exploited.address
    }
    // the second transaction will send the NFT from the exploited address to the sponsor address
    const tx2 = { 
        // goerli testnet
        chainId: CHAIN_ID,
        // EIP-1559 style transaction
        type: 2, 
        // no ether is transferred when moving the NFT to the safe sponsor account
        value: ethers.utils.parseUnits("0", "ether"),
        // the necessary tx calldata required to transfer the NFT using `transferFrom`
        data: nftTransfer.data,
        // the max fee per unit of gas (arbitrarily set)
        maxFeePerGas: ethers.utils.parseUnits("3", "gwei"),
        // the max miner tip to pay (arbitrarily set)
        maxPriorityFeePerGas: ethers.utils.parseUnits("2", "gwei"),
        // the gas limit (arbitrarily set)
        gasLimit: 100000,
        // the transaction must interact directly with the deployed NFT address on goerli network
        to: nftAddress
    }
    // sign the transactions into a single flashbots bundle
    const signedTxBundle = await flashbotProvider.signBundle([
        {   
            // the sponsor will be sending ETH to the exploited address in tx1
            signer: sponsor,
            transaction: tx1
        },
        {
            // the exploited address will send the NFT to the sponsor address in tx2
            signer: exploited,
            transaction: tx2
        }
    ]);
    // for each block we need to continously re-submit the bundle transaction until it is selected by a miner
    provider.on("block", async(blockNumber) => {
        console.log("Current Block: ", blockNumber);        
        // send the signed bundle transaction data to the flashbots relayers for the closest next future block (ie: t+1)
        const signedBundle = await flashbotProvider.sendRawBundle(signedTxBundle, blockNumber + 1);
        // wait until we receive a response and exit only once the transaction has been mined in the blockchain
        const waitResponse = await signedBundle.wait();        
        if(waitResponse == 0) {
            console.log("Successfully transferred the NFT to the sponsor address");
            process.exit();
        }
    });
}

main()



