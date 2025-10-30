pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract SocialTokenDEXFHE is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    address public owner;
    mapping(address => bool) public isProvider;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;
    uint256 public cooldownSeconds = 60; // Default cooldown: 60 seconds

    bool public paused;

    uint256 public currentBatchId = 1;
    bool public batchOpen = false;

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }
    mapping(uint256 => DecryptionContext) public decryptionContexts;

    // Encrypted data storage for a batch
    // For simplicity, this example stores a single euint32 per provider per batch.
    // A real DEX would store more complex data structures.
    mapping(uint256 => mapping(address => euint32)) public encryptedProviderData;

    // Custom Errors
    error NotOwner();
    error NotProvider();
    error Paused();
    error CooldownActive();
    error BatchNotOpen();
    error InvalidParameter();
    error ReplayAttempt();
    error StateMismatch();
    error InvalidProof();
    error AlreadyProcessed();

    // Events
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event Paused(address account);
    event Unpaused(address account);
    event CooldownSet(uint256 oldCooldownSeconds, uint256 newCooldownSeconds);
    event BatchOpened(uint256 indexed batchId);
    event BatchClosed(uint256 indexed batchId);
    event DataSubmitted(address indexed provider, uint256 indexed batchId, bytes32 encryptedData);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId, bytes32 stateHash);
    event DecryptionCompleted(uint256 indexed requestId, uint256 indexed batchId, uint256 decryptedValue);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier checkSubmissionCooldown() {
        if (block.timestamp < lastSubmissionTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    modifier checkDecryptionCooldown() {
        if (block.timestamp < lastDecryptionRequestTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    constructor() {
        owner = msg.sender;
        isProvider[owner] = true; // Owner is initially a provider
        emit ProviderAdded(owner);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function addProvider(address provider) external onlyOwner {
        if (provider == address(0)) revert InvalidParameter();
        if (!isProvider[provider]) {
            isProvider[provider] = true;
            emit ProviderAdded(provider);
        }
    }

    function removeProvider(address provider) external onlyOwner {
        if (provider == address(0)) revert InvalidParameter();
        if (isProvider[provider]) {
            isProvider[provider] = false;
            emit ProviderRemoved(provider);
        }
    }

    function pause() external onlyOwner whenNotPaused {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        if (!paused) revert Paused(); // Cannot unpause if not paused
        paused = false;
        emit Unpaused(msg.sender);
    }

    function setCooldownSeconds(uint256 newCooldownSeconds) external onlyOwner {
        if (newCooldownSeconds == 0) revert InvalidParameter();
        uint256 oldCooldownSeconds = cooldownSeconds;
        cooldownSeconds = newCooldownSeconds;
        emit CooldownSet(oldCooldownSeconds, newCooldownSeconds);
    }

    function openBatch() external onlyOwner whenNotPaused {
        if (batchOpen) {
            currentBatchId++;
        }
        batchOpen = true;
        emit BatchOpened(currentBatchId);
    }

    function closeBatch() external onlyOwner whenNotPaused {
        if (!batchOpen) revert BatchNotOpen();
        batchOpen = false;
        emit BatchClosed(currentBatchId);
    }

    function submitEncryptedData(euint32 encryptedData) external onlyProvider whenNotPaused checkSubmissionCooldown {
        if (!batchOpen) revert BatchNotOpen();
        if (!encryptedData.isInitialized()) revert InvalidParameter();

        encryptedProviderData[currentBatchId][msg.sender] = encryptedData;
        lastSubmissionTime[msg.sender] = block.timestamp;

        emit DataSubmitted(msg.sender, currentBatchId, encryptedData.toBytes32());
    }

    function requestAggregatedDecryption() external onlyProvider whenNotPaused checkDecryptionCooldown {
        if (batchOpen) revert BatchNotOpen(); // Batch must be closed for aggregation

        // 1. Prepare Ciphertexts: For this example, we'll sum all provider data for the current batch.
        //    The `cts` array will contain the single aggregated ciphertext.
        euint32 memory aggregatedEncryptedValue;
        bool initialized = false;

        for (uint256 i = 0; i < 5; i++) { // Example: iterate up to 5 providers for simplicity
            address providerAddr = address(uint160(i + 1)); // Example provider addresses
            if (isProvider[providerAddr] && encryptedProviderData[currentBatchId][providerAddr].isInitialized()) {
                if (!initialized) {
                    aggregatedEncryptedValue = encryptedProviderData[currentBatchId][providerAddr];
                    initialized = true;
                } else {
                    aggregatedEncryptedValue = aggregatedEncryptedValue.add(encryptedProviderData[currentBatchId][providerAddr]);
                }
            }
        }

        if (!initialized) revert InvalidParameter(); // No data to aggregate

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = aggregatedEncryptedValue.toBytes32();

        // 2. Compute State Hash
        bytes32 stateHash = _hashCiphertexts(cts);

        // 3. Request Decryption
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);

        // 4. Store Context
        decryptionContexts[requestId] = DecryptionContext({
            batchId: currentBatchId,
            stateHash: stateHash,
            processed: false
        });

        lastDecryptionRequestTime[msg.sender] = block.timestamp;
        emit DecryptionRequested(requestId, currentBatchId, stateHash);
    }

    function myCallback(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        // 5a. Replay Guard
        if (decryptionContexts[requestId].processed) revert AlreadyProcessed();

        // 5b. State Verification
        // Rebuild the `cts` array from current contract storage in the *exact same order* as in step 1.
        // This is crucial for ensuring the state hasn't changed since the decryption was requested.
        euint32 memory currentAggregatedEncryptedValue;
        bool initialized = false;
        for (uint256 i = 0; i < 5; i++) { // Must match the logic in requestAggregatedDecryption
            address providerAddr = address(uint160(i + 1));
            if (isProvider[providerAddr] && encryptedProviderData[decryptionContexts[requestId].batchId][providerAddr].isInitialized()) {
                if (!initialized) {
                    currentAggregatedEncryptedValue = encryptedProviderData[decryptionContexts[requestId].batchId][providerAddr];
                    initialized = true;
                } else {
                    currentAggregatedEncryptedValue = currentAggregatedEncryptedValue.add(encryptedProviderData[decryptionContexts[requestId].batchId][providerAddr]);
                }
            }
        }

        if (!initialized) revert StateMismatch(); // Should not happen if request was valid

        bytes32[] memory currentCts = new bytes32[](1);
        currentCts[0] = currentAggregatedEncryptedValue.toBytes32();

        bytes32 currentStateHash = _hashCiphertexts(currentCts);
        if (currentStateHash != decryptionContexts[requestId].stateHash) {
            revert StateMismatch();
        }

        // 5c. Proof Verification
        if (!FHE.checkSignatures(requestId, cleartexts, proof)) {
            revert InvalidProof();
        }

        // 5d. Decode & Finalize
        // The `cleartexts` should contain one uint256 value for our single aggregated ciphertext.
        uint256 decryptedValue = abi.decode(cleartexts, (uint256));

        decryptionContexts[requestId].processed = true;
        emit DecryptionCompleted(requestId, decryptionContexts[requestId].batchId, decryptedValue);
    }

    function _hashCiphertexts(bytes32[] memory cts) internal pure returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }

    function _initIfNeeded(euint32 storage eVal, uint32 clearVal) internal {
        if (!eVal.isInitialized()) {
            eVal = FHE.asEuint32(clearVal);
        }
    }

    function _requireInitialized(euint32 storage eVal) internal view {
        if (!eVal.isInitialized()) revert InvalidParameter();
    }
}