// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract NameRegistry is Ownable, ReentrancyGuard {
    using ECDSA for bytes32;

    event SignatureRequested(address indexed user, bytes signature);
    event NameRegistered(
        address indexed user,
        string name,
        uint256 lockedAmount
    );
    event NameRenew(address indexed user, string name);
    event EtherUnlocked(
        address indexed user,
        string name,
        uint256 unlockAmount
    );

    struct NameRecord {
        address owner;
        uint64 maturity;
        uint256 lockAmount;
    }

    struct RequestSignature {
        bytes signature;
        uint64 blockId;
    }

    uint256 public lockAmount;
    uint256 public feePerChar;
    address public treasury;
    uint64 public lockPeriod;
    uint64 public waitBlocks;

    mapping(address => RequestSignature) public requestSignatures;
    mapping(string => NameRecord) public records;
    mapping(address => uint256) public unlockedEthers;

    constructor(
        uint256 _lockAmount,
        uint256 _feePerChar,
        address _treasury,
        uint64 _lockPeriod,
        uint64 _waitBlocks
    ) {
        require(_lockPeriod > 0, "invalid period");
        require(_lockAmount > 0, "invalid amount");

        // feePerChar can be zero for fee register service
        // waitBlocks can be zero
        require(_treasury != address(0), "invalid treasury");

        lockPeriod = _lockPeriod;
        lockAmount = _lockAmount;
        feePerChar = _feePerChar;
        treasury = _treasury;
        waitBlocks = _waitBlocks;
    }

    /**
     * @notice register signature of name before register name
     * @param signature signature of name signed by msg.sender
     * @param cancelPending force cancel old signature
     */
    function registerRequestSignature(
        bytes calldata signature,
        bool cancelPending
    ) external {
        RequestSignature storage requestSignature = requestSignatures[
            msg.sender
        ];
        require(
            cancelPending || requestSignature.blockId == 0,
            "has pending request"
        );
        requestSignature.signature = signature;
        requestSignature.blockId = uint64(block.number);

        emit SignatureRequested(msg.sender, signature);
    }

    /**
     * @notice register name
     *  requirements:
     *    - signature must be registered first
     *    - must register `waitBlocks`
     *    - send more than lock amount and register fee. (register fee = feePerChat * name.length)
     *    - if name registered in the past and expired, it will be replaced.
     * @param name name to register
     */
    function registerName(string calldata name) external payable nonReentrant {
        RequestSignature storage requestSignature = requestSignatures[
            msg.sender
        ];
        require(
            requestSignature.blockId > 0 &&
                requestSignature.blockId + waitBlocks <= block.number,
            "no request or wait more blocks"
        );
        require(
            keccak256(bytes(name)).toEthSignedMessageHash().recover(
                requestSignature.signature
            ) == msg.sender,
            "invalid signature"
        );
        uint256 fee = feePerChar * bytes(name).length;
        uint256 requiredEther = fee + lockAmount;
        require(msg.value >= requiredEther, "no enough ether");
        unlockedEthers[msg.sender] += msg.value - requiredEther;
        if (fee > 0) {
            (bool success, ) = treasury.call{value: fee}("");
            require(success, "eth transfer failed");
        }

        delete requestSignatures[msg.sender];

        NameRecord storage record = records[name];
        if (record.owner != address(0)) {
            require(record.maturity < block.timestamp, "not expired");
            unlockedEthers[record.owner] += record.lockAmount;
            emit EtherUnlocked(record.owner, name, record.lockAmount);
        }
        record.owner = msg.sender;
        record.maturity = uint64(block.timestamp) + lockPeriod;
        record.lockAmount = lockAmount;

        emit NameRegistered(msg.sender, name, lockAmount);
    }

    /**
     * @notice renew name
     *  requirements:
     *    - must register name in the past
     *    - send more than renew fee. (renew fee = feePerChat * name.length)
     *    - can renew before or after maturity, if it is not replaced by other
     *    - if name is not expired, then use previous maturity as renew time, other wise, use block.timestamp as renew time
     * @param name name to renew
     */
    function renew(string calldata name) external payable nonReentrant {
        NameRecord storage record = records[name];
        require(record.owner == msg.sender, "not owner");

        uint256 fee = feePerChar * bytes(name).length;
        require(msg.value >= fee, "no enough ether");
        unlockedEthers[msg.sender] += msg.value - fee;
        if (fee > 0) {
            (bool success, ) = treasury.call{value: fee}("");
            require(success, "eth transfer failed");
        }

        uint64 currentTime = uint64(block.timestamp);
        record.maturity =
            (currentTime >= record.maturity ? currentTime : record.maturity) +
            lockPeriod;

        emit NameRenew(msg.sender, name);
    }

    /**
     * @notice unlock ether after maturity and send to user address
     * @param name name to unlock
     */
    function unlock(string calldata name) external nonReentrant {
        NameRecord storage record = records[name];
        require(
            record.owner == msg.sender && record.maturity < block.timestamp,
            "invalid owner or not expired"
        );
        emit EtherUnlocked(msg.sender, name, record.lockAmount);
        uint256 etherToUnlock = record.lockAmount + unlockedEthers[msg.sender];

        unlockedEthers[msg.sender] = 0;
        delete records[name];

        (bool success, ) = msg.sender.call{value: etherToUnlock}("");
        require(success, "eth transfer failed");
    }

    /**
     * @notice withdraw unlock ether
     */
    function withdrawUnlockedEther() external nonReentrant {
        require(unlockedEthers[msg.sender] > 0, "no ether unlocked");

        uint256 etherToUnlock = unlockedEthers[msg.sender];
        unlockedEthers[msg.sender] = 0;
        (bool success, ) = msg.sender.call{value: etherToUnlock}("");
        require(success, "eth transfer failed");
    }

    /**
     * @notice set lock period
     *  requirements:
     *    - only owner can call
     *    - value must be greater than zero
     * @param _lockPeriod new lock period
     */
    function setLockPeriod(uint64 _lockPeriod) external onlyOwner {
        require(_lockPeriod > 0, "invalid period");
        lockPeriod = _lockPeriod;
    }

    /**
     * @notice set lock amount
     *  requirements:
     *    - only owner can call
     *    - value must be greater than zero
     * @param _lockAmount new lock amount
     */
    function setLockAmount(uint256 _lockAmount) external onlyOwner {
        require(_lockAmount > 0, "invalid amount");
        lockAmount = _lockAmount;
    }

    /**
     * @notice set feePerChar
     *  requirements:
     *    - only owner can call
     * @param _feePerChar new value
     */
    function setFeePerChar(uint256 _feePerChar) external onlyOwner {
        feePerChar = _feePerChar;
    }

    /**
     * @notice set treasury
     *  requirements:
     *    - only owner can call
     *    - treasury can not be 0x0
     * @param _treasury new treasury address
     */
    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "invalid treasury");
        treasury = _treasury;
    }

    /**
     * @notice set waitBlocks
     *  requirements:
     *    - only owner can call
     * @param _waitBlocks new value
     */
    function setWaitBlocks(uint64 _waitBlocks) external onlyOwner {
        waitBlocks = _waitBlocks;
    }
}
