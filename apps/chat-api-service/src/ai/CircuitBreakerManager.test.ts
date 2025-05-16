import { DynamoDBClient } from "@aws-sdk/client-dynamodb"; // Import DynamoDBClient
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock"; // Using aws-sdk-client-mock for easier mocking
import "aws-sdk-client-mock-jest"; // Extends jest matchers
import { CircuitBreakerManager } from "./CircuitBreakerManager";
import { ProviderHealthState } from "../../../../packages/common-types/src/ai-interfaces";

// Mock the DynamoDBDocumentClient
const ddbMock = mockClient(DynamoDBDocumentClient);
const baseDdbClient = new DynamoDBClient({ region: "us-east-1" }); // Base client for instantiation

describe("CircuitBreakerManager", () => {
    let manager: CircuitBreakerManager;
    const tableName = "TestProviderHealthTable";
    const providerRegion = "TestProvider#test-region-1";
    const now = Date.now(); // For consistent timestamps in tests

    // Default constants from the class, can be overridden in specific tests if needed
    const DEFAULT_FAILURE_THRESHOLD = 3;
    const DEFAULT_COOLDOWN_PERIOD_MS = 30 * 1000;
    const DEFAULT_HALF_OPEN_SUCCESS_THRESHOLD = 2;
    const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 7;

    let consoleErrorSpy: jest.SpyInstance;
    let consoleWarnSpy: jest.SpyInstance;
    let consoleLogSpy: jest.SpyInstance;

    beforeEach(() => {
        ddbMock.reset(); // Reset mocks before each test
        // Correctly instantiate DynamoDBDocumentClient
        manager = new CircuitBreakerManager(DynamoDBDocumentClient.from(baseDdbClient), tableName);
        jest.spyOn(Date, 'now').mockImplementation(() => now); // Mock Date.now()

        // Suppress console messages for all tests unless a specific test re-spies
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks(); // Restore Date.now() and other mocks
        consoleErrorSpy.mockRestore();
        consoleWarnSpy.mockRestore();
        consoleLogSpy.mockRestore();
    });

    describe("constructor", () => {
        it("should use default constants if not provided", () => {
            const newManager = new CircuitBreakerManager(DynamoDBDocumentClient.from(baseDdbClient), tableName);
            // Access private members for testing - normally not recommended, but useful here
            expect((newManager as any).failureThreshold).toBe(DEFAULT_FAILURE_THRESHOLD);
            expect((newManager as any).cooldownPeriodMs).toBe(DEFAULT_COOLDOWN_PERIOD_MS);
            expect((newManager as any).halfOpenSuccessThreshold).toBe(DEFAULT_HALF_OPEN_SUCCESS_THRESHOLD);
            expect((newManager as any).recordTtlSeconds).toBe(DEFAULT_TTL_SECONDS);
        });

        it("should use provided constants", () => {
            const newManager = new CircuitBreakerManager(
                DynamoDBDocumentClient.from(baseDdbClient), 
                tableName,
                5, // failureThreshold
                60000, // cooldownPeriodMs
                3, // halfOpenSuccessThreshold
                86400 // recordTtlSeconds (1 day)
            );
            expect((newManager as any).failureThreshold).toBe(5);
            expect((newManager as any).cooldownPeriodMs).toBe(60000);
            expect((newManager as any).halfOpenSuccessThreshold).toBe(3);
            expect((newManager as any).recordTtlSeconds).toBe(86400);
        });
    });

    describe("getProviderHealth", () => {
        it("should return null if item is not found", async () => {
            ddbMock.on(GetCommand).resolves({}); // Simulate item not found
            const result = await manager.getProviderHealth(providerRegion);
            expect(result).toBeNull();
            expect(ddbMock).toHaveReceivedCommandWith(GetCommand, { TableName: tableName, Key: { providerRegion } });
        });

        it("should return the item if found", async () => {
            const mockHealthState: ProviderHealthState = {
                providerRegion,
                status: 'CLOSED',
                consecutiveFailures: 0,
                currentHalfOpenSuccesses: 0,
                totalFailures: 0,
                totalSuccesses: 1,
                lastStateChangeTimestamp: now - 1000,
                ttl: Math.floor(now / 1000) + DEFAULT_TTL_SECONDS,
                totalLatencyMs: 0,
            };
            ddbMock.on(GetCommand).resolves({ Item: mockHealthState });
            const result = await manager.getProviderHealth(providerRegion);
            expect(result).toEqual(mockHealthState);
        });

        it("should throw error if DynamoDB GetCommand fails", async () => {
            const dbError = new Error("DynamoDB error");
            ddbMock.on(GetCommand).rejects(dbError);
            await expect(manager.getProviderHealth(providerRegion)).rejects.toThrow(dbError);
        });
    });

    describe("updateProviderHealth", () => {
        it("should call PutCommand with the correct parameters and TTL", async () => {
            const healthState: ProviderHealthState = {
                providerRegion,
                status: 'CLOSED',
                consecutiveFailures: 0,
                currentHalfOpenSuccesses: 0,
                totalFailures: 0,
                totalSuccesses: 1,
                lastStateChangeTimestamp: now,
                totalLatencyMs: 0,
                // TTL will be recalculated by the method
            };
            ddbMock.on(PutCommand).resolves({});
            await manager.updateProviderHealth(healthState);

            const expectedTtl = Math.floor(now / 1000) + DEFAULT_TTL_SECONDS;
            expect(ddbMock).toHaveReceivedCommandWith(PutCommand, {
                TableName: tableName,
                Item: { ...healthState, ttl: expectedTtl },
            });
        });

        it("should use existing valid TTL if provided", async () => {
            const futureTtl = Math.floor(now / 1000) + DEFAULT_TTL_SECONDS * 2; // A TTL further in the future
            const healthState: ProviderHealthState = {
                providerRegion,
                status: 'CLOSED',
                consecutiveFailures: 0,
                currentHalfOpenSuccesses: 0,
                totalFailures: 0,
                totalSuccesses: 1,
                lastStateChangeTimestamp: now,
                ttl: futureTtl,
                totalLatencyMs: 0,
            };
            ddbMock.on(PutCommand).resolves({});
            await manager.updateProviderHealth(healthState);

            expect(ddbMock).toHaveReceivedCommandWith(PutCommand, {
                TableName: tableName,
                Item: { ...healthState, ttl: futureTtl }, // Expecting the provided futureTtl to be used
            });
        });

        it("should throw error if DynamoDB PutCommand fails", async () => {
            const healthState: ProviderHealthState = {
                providerRegion,
                status: 'CLOSED',
                consecutiveFailures: 0,
                currentHalfOpenSuccesses: 0,
                totalFailures: 0,
                totalSuccesses: 1,
                lastStateChangeTimestamp: now,
                totalLatencyMs: 0,
            };
            const dbError = new Error("DynamoDB put error");
            ddbMock.on(PutCommand).rejects(dbError);
            await expect(manager.updateProviderHealth(healthState)).rejects.toThrow(dbError);
        });
    });

    describe("recordSuccess", () => {
        it("should create default CLOSED state and record success if no state exists", async () => {
            ddbMock.on(GetCommand).resolves({}); // No item initially
            ddbMock.on(PutCommand).resolves({}); // Mock successful put

            await manager.recordSuccess(providerRegion);

            const expectedDefaultState: ProviderHealthState = {
                providerRegion,
                status: 'CLOSED',
                consecutiveFailures: 0,
                totalFailures: 0,
                totalSuccesses: 1, // Incremented
                currentHalfOpenSuccesses: 0, // Should be initialized or reset
                lastStateChangeTimestamp: now,
                openedTimestamp: undefined, // Not opened yet
                lastFailureTimestamp: undefined, // No failures yet
                ttl: Math.floor(now / 1000) + DEFAULT_TTL_SECONDS,
                totalLatencyMs: 0,
            };

            expect(ddbMock).toHaveReceivedCommandTimes(GetCommand, 1);
            expect(ddbMock).toHaveReceivedCommandWith(GetCommand, { TableName: tableName, Key: { providerRegion } });
            
            expect(ddbMock).toHaveReceivedCommandTimes(PutCommand, 1);
            // Check the Item property of the PutCommand input
            const putCommandCalls = ddbMock.commandCalls(PutCommand);
            expect(putCommandCalls.length).toBe(1);
            const putArgs = putCommandCalls[0].args[0].input;
            expect(putArgs.Item).toEqual(expect.objectContaining({
                ...expectedDefaultState,
                currentHalfOpenSuccesses: 0, // Ensure it's explicitly set/reset
            }));        
        });

        it('should reset consecutiveFailures and increment totalSuccesses if status is CLOSED', async () => {
            const initialState: ProviderHealthState = {
                providerRegion,
                status: 'CLOSED',
                consecutiveFailures: 1, // Had a previous failure but still closed
                totalFailures: 1,
                totalSuccesses: 5,
                currentHalfOpenSuccesses: 0,
                lastStateChangeTimestamp: now - 1000,
                ttl: Math.floor((now - 1000) / 1000) + DEFAULT_TTL_SECONDS,
                totalLatencyMs: 0,
            };
            ddbMock.on(GetCommand).resolves({ Item: initialState });
            ddbMock.on(PutCommand).resolves({});

            await manager.recordSuccess(providerRegion);

            const expectedState: Partial<ProviderHealthState> = {
                status: 'CLOSED',
                consecutiveFailures: 0, // Reset
                totalSuccesses: 6, // Incremented
                lastStateChangeTimestamp: now,
            };

            expect(ddbMock).toHaveReceivedCommandTimes(PutCommand, 1);
            const putCommandCalls = ddbMock.commandCalls(PutCommand);
            expect(putCommandCalls.length).toBe(1);
            const putArgs = putCommandCalls[0].args[0].input;
            expect(putArgs.Item).toEqual(expect.objectContaining(expectedState));
        });

        it('should increment currentHalfOpenSuccesses and stay HALF_OPEN if threshold not met', async () => {
            const initialState: ProviderHealthState = {
                providerRegion,
                status: 'HALF_OPEN',
                consecutiveFailures: 0,
                currentHalfOpenSuccesses: 0,
                totalFailures: 10, // Arbitrary
                totalSuccesses: 20, // Arbitrary
                lastStateChangeTimestamp: now - 1000,
                openedTimestamp: now - 10000, // Was open before going half-open
                ttl: Math.floor((now - 1000) / 1000) + DEFAULT_TTL_SECONDS,
                totalLatencyMs: 0,
            };
            ddbMock.on(GetCommand).resolves({ Item: initialState });
            ddbMock.on(PutCommand).resolves({});

            await manager.recordSuccess(providerRegion);

            const expectedState: Partial<ProviderHealthState> = {
                status: 'HALF_OPEN',
                totalSuccesses: 21, // Incremented
                currentHalfOpenSuccesses: 1, // Incremented
                lastStateChangeTimestamp: now,
            };
            const putArgs = ddbMock.commandCalls(PutCommand)[0].args[0].input;
            expect(putArgs.Item).toEqual(expect.objectContaining(expectedState));
        });

        it('should transition from HALF_OPEN to CLOSED if success threshold is met', async () => {
            const initialState: ProviderHealthState = {
                providerRegion,
                status: 'HALF_OPEN',
                consecutiveFailures: 0,
                currentHalfOpenSuccesses: DEFAULT_HALF_OPEN_SUCCESS_THRESHOLD - 1, // One success away from closing
                totalFailures: 10,
                totalSuccesses: 20,
                lastStateChangeTimestamp: now - 1000,
                openedTimestamp: now - 10000,
                ttl: Math.floor((now - 1000) / 1000) + DEFAULT_TTL_SECONDS,
                totalLatencyMs: 0,
            };
            ddbMock.on(GetCommand).resolves({ Item: initialState });
            ddbMock.on(PutCommand).resolves({});
            jest.spyOn(console, 'log'); // To check for the transition log

            await manager.recordSuccess(providerRegion);

            const expectedState: Partial<ProviderHealthState> = {
                status: 'CLOSED',
                totalSuccesses: 21,
                consecutiveFailures: 0,
                currentHalfOpenSuccesses: 0, // Reset
                lastStateChangeTimestamp: now,
            };
            const putArgs = ddbMock.commandCalls(PutCommand)[0].args[0].input;
            expect(putArgs.Item).toEqual(expect.objectContaining(expectedState));
            expect(console.log).toHaveBeenCalledWith(expect.stringContaining("transitioning from HALF_OPEN to CLOSED"));
        });

        it('should treat success in OPEN state as HALF_OPEN success and potentially close', async () => {
            // This test assumes DEFAULT_HALF_OPEN_SUCCESS_THRESHOLD is 1 or 2 for simplicity with the fall-through logic
            // If DEFAULT_HALF_OPEN_SUCCESS_THRESHOLD is 1, it should close immediately.
            const halfOpenThresholdForTest = 1; 
            const testManager = new CircuitBreakerManager(DynamoDBDocumentClient.from(baseDdbClient), tableName, DEFAULT_FAILURE_THRESHOLD, DEFAULT_COOLDOWN_PERIOD_MS, halfOpenThresholdForTest);

            const initialState: ProviderHealthState = {
                providerRegion,
                status: 'OPEN',
                consecutiveFailures: DEFAULT_FAILURE_THRESHOLD + 1, // Circuit is definitely open
                currentHalfOpenSuccesses: 0, // Should be irrelevant for OPEN, but reset on transition
                totalFailures: 10,
                totalSuccesses: 20,
                lastStateChangeTimestamp: now - 1000,
                openedTimestamp: now - 10000,
                lastFailureTimestamp: now - 1000,
                ttl: Math.floor((now - 1000) / 1000) + DEFAULT_TTL_SECONDS,
                totalLatencyMs: 0,
            };
            ddbMock.on(GetCommand).resolves({ Item: initialState });
            ddbMock.on(PutCommand).resolves({});
            jest.spyOn(console, 'warn');
            jest.spyOn(console, 'log');

            await testManager.recordSuccess(providerRegion);

            const expectedState: Partial<ProviderHealthState> = {
                status: 'CLOSED', // Because threshold is 1 for this specific testManager instance
                totalSuccesses: 21,
                consecutiveFailures: 0,
                currentHalfOpenSuccesses: 0, // Reset
                lastStateChangeTimestamp: now,
            };
            const putArgs = ddbMock.commandCalls(PutCommand)[0].args[0].input;
            expect(putArgs.Item).toEqual(expect.objectContaining(expectedState));
            expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("Recorded success for TestProvider#test-region-1 while status was OPEN"));
            expect(console.log).toHaveBeenCalledWith(expect.stringContaining("transitioning from HALF_OPEN to CLOSED"));
        });

    });

    describe("recordFailure", () => {
        it("should create default CLOSED state and record failure if no state exists", async () => {
            ddbMock.on(GetCommand).resolves({}); // No item initially
            ddbMock.on(PutCommand).resolves({});

            await manager.recordFailure(providerRegion);

            const expectedDefaultState: Partial<ProviderHealthState> = {
                providerRegion,
                status: 'CLOSED',
                consecutiveFailures: 1, // Incremented
                totalFailures: 1,     // Incremented
                totalSuccesses: 0,
                currentHalfOpenSuccesses: 0,
                lastStateChangeTimestamp: now,
                lastFailureTimestamp: now, // Set
                openedTimestamp: undefined, 
            };
            const putArgs = ddbMock.commandCalls(PutCommand)[0].args[0].input;
            expect(putArgs.Item).toEqual(expect.objectContaining(expectedDefaultState));
        });

        it("should increment consecutiveFailures and stay CLOSED if threshold not met", async () => {
            const initialState: ProviderHealthState = {
                providerRegion,
                status: 'CLOSED',
                consecutiveFailures: 1, // Below threshold (default is 3)
                totalFailures: 1,
                totalSuccesses: 5,
                currentHalfOpenSuccesses: 0,
                lastStateChangeTimestamp: now - 1000,
                lastFailureTimestamp: now - 1000,
                ttl: Math.floor((now - 1000) / 1000) + DEFAULT_TTL_SECONDS,
                totalLatencyMs: 0,
            };
            ddbMock.on(GetCommand).resolves({ Item: initialState });
            ddbMock.on(PutCommand).resolves({});

            await manager.recordFailure(providerRegion);

            const expectedState: Partial<ProviderHealthState> = {
                status: 'CLOSED',
                consecutiveFailures: 2, // Incremented
                totalFailures: 2,     // Incremented
                lastFailureTimestamp: now,
                lastStateChangeTimestamp: now,
            };
            const putArgs = ddbMock.commandCalls(PutCommand)[0].args[0].input;
            expect(putArgs.Item).toEqual(expect.objectContaining(expectedState));
        });

        it("should transition from CLOSED to OPEN if failure threshold is met", async () => {
            const initialState: ProviderHealthState = {
                providerRegion,
                status: 'CLOSED',
                consecutiveFailures: DEFAULT_FAILURE_THRESHOLD - 1, // One failure away from opening
                totalFailures: DEFAULT_FAILURE_THRESHOLD - 1,
                totalSuccesses: 5,
                currentHalfOpenSuccesses: 0,
                lastStateChangeTimestamp: now - 1000,
                lastFailureTimestamp: now - 1000,
                ttl: Math.floor((now - 1000) / 1000) + DEFAULT_TTL_SECONDS,
                totalLatencyMs: 0,
            };
            ddbMock.on(GetCommand).resolves({ Item: initialState });
            ddbMock.on(PutCommand).resolves({});
            jest.spyOn(console, 'log');

            await manager.recordFailure(providerRegion);

            const expectedState: Partial<ProviderHealthState> = {
                status: 'OPEN',
                consecutiveFailures: DEFAULT_FAILURE_THRESHOLD,
                totalFailures: DEFAULT_FAILURE_THRESHOLD,
                openedTimestamp: now,
                currentHalfOpenSuccesses: 0,
                lastFailureTimestamp: now,
                lastStateChangeTimestamp: now,
            };
            const putArgs = ddbMock.commandCalls(PutCommand)[0].args[0].input;
            expect(putArgs.Item).toEqual(expect.objectContaining(expectedState));
            expect(console.log).toHaveBeenCalledWith(expect.stringContaining("transitioning from CLOSED to OPEN"));
        });

        it("should transition from HALF_OPEN to OPEN on any failure", async () => {
            const initialState: ProviderHealthState = {
                providerRegion,
                status: 'HALF_OPEN',
                consecutiveFailures: 0, 
                currentHalfOpenSuccesses: 1, // Had one success in half-open
                totalFailures: 5,
                totalSuccesses: 10,
                lastStateChangeTimestamp: now - 1000,
                openedTimestamp: now - 10000, // Original open time
                ttl: Math.floor((now - 1000) / 1000) + DEFAULT_TTL_SECONDS,
                totalLatencyMs: 0,
            };
            ddbMock.on(GetCommand).resolves({ Item: initialState });
            ddbMock.on(PutCommand).resolves({});
            jest.spyOn(console, 'log');

            await manager.recordFailure(providerRegion);

            const expectedState: Partial<ProviderHealthState> = {
                status: 'OPEN',
                consecutiveFailures: 1, // Incremented from 0
                totalFailures: 6,
                openedTimestamp: now, // Reset to now because it re-opened
                currentHalfOpenSuccesses: 0, // Reset
                lastFailureTimestamp: now,
                lastStateChangeTimestamp: now,
            };
            const putArgs = ddbMock.commandCalls(PutCommand)[0].args[0].input;
            expect(putArgs.Item).toEqual(expect.objectContaining(expectedState));
            expect(console.log).toHaveBeenCalledWith(expect.stringContaining("transitioning from HALF_OPEN to OPEN"));
        });

        it("should stay OPEN and update counts if already OPEN", async () => {
            const initialOpenedTimestamp = now - 20000; // Was opened some time ago
            const initialState: ProviderHealthState = {
                providerRegion,
                status: 'OPEN',
                consecutiveFailures: DEFAULT_FAILURE_THRESHOLD + 2, // Well above threshold
                currentHalfOpenSuccesses: 0,
                totalFailures: 10,
                totalSuccesses: 1,
                lastStateChangeTimestamp: now - 1000,
                openedTimestamp: initialOpenedTimestamp,
                lastFailureTimestamp: now - 1000,
                ttl: Math.floor((now - 1000) / 1000) + DEFAULT_TTL_SECONDS,
                totalLatencyMs: 0,
            };
            ddbMock.on(GetCommand).resolves({ Item: initialState });
            ddbMock.on(PutCommand).resolves({});
            jest.spyOn(console, 'log');

            await manager.recordFailure(providerRegion);

            const expectedState: Partial<ProviderHealthState> = {
                status: 'OPEN',
                consecutiveFailures: DEFAULT_FAILURE_THRESHOLD + 3,
                totalFailures: 11,
                openedTimestamp: initialOpenedTimestamp, // Should remain the original opened time
                lastFailureTimestamp: now,
                lastStateChangeTimestamp: now,
            };
            const putArgs = ddbMock.commandCalls(PutCommand)[0].args[0].input;
            expect(putArgs.Item).toEqual(expect.objectContaining(expectedState));
            expect(console.log).toHaveBeenCalledWith(expect.stringContaining("recorded additional failure while already OPEN"));
        });
    });

    describe("isRequestAllowed", () => {
        it("should create default state and allow request if no state exists", async () => {
            ddbMock.on(GetCommand).resolves({}); // No item initially
            ddbMock.on(PutCommand).resolves({});
            jest.spyOn(console, 'log');

            const allowed = await manager.isRequestAllowed(providerRegion);

            expect(allowed).toBe(true);
            expect(ddbMock).toHaveReceivedCommandTimes(PutCommand, 1);
            const putCommandCalls = ddbMock.commandCalls(PutCommand);
            expect(putCommandCalls.length).toBe(1);
            const putArgs = putCommandCalls[0].args[0].input;
            expect(putArgs).toBeDefined();
            expect(putArgs.Item).toBeDefined();
            if (putArgs && putArgs.Item) { // Linter guard
                expect(putArgs.Item.status).toBe('CLOSED');
            }
            expect(console.log).toHaveBeenCalledWith(expect.stringContaining("No health state for TestProvider#test-region-1. Creating default and allowing request."));
        });

        it("should allow request if status is CLOSED", async () => {
            const initialState: ProviderHealthState = {
                providerRegion, status: 'CLOSED', consecutiveFailures: 0, totalFailures: 0, totalSuccesses: 1,
                currentHalfOpenSuccesses: 0, lastStateChangeTimestamp: now -1000, ttl: 0, totalLatencyMs: 0,
            };
            ddbMock.on(GetCommand).resolves({ Item: initialState });

            const allowed = await manager.isRequestAllowed(providerRegion);
            expect(allowed).toBe(true);
            expect(ddbMock).not.toHaveReceivedCommand(PutCommand); // No state change
        });

        it("should deny request if status is OPEN and cooldown has not passed", async () => {
            const initialState: ProviderHealthState = {
                providerRegion, status: 'OPEN', consecutiveFailures: DEFAULT_FAILURE_THRESHOLD, 
                totalFailures: 3, totalSuccesses: 0, currentHalfOpenSuccesses: 0, 
                openedTimestamp: now - (DEFAULT_COOLDOWN_PERIOD_MS / 2), // Cooldown not passed
                lastStateChangeTimestamp: now - 1000, ttl: 0, totalLatencyMs: 0,
            };
            ddbMock.on(GetCommand).resolves({ Item: initialState });
            jest.spyOn(console, 'log');

            const allowed = await manager.isRequestAllowed(providerRegion);
            expect(allowed).toBe(false);
            expect(ddbMock).not.toHaveReceivedCommand(PutCommand);
            expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Request to TestProvider#test-region-1 blocked. Circuit is OPEN and in cooldown."));
        });

        it("should transition to HALF_OPEN and allow request if status is OPEN and cooldown has passed", async () => {
            const initialState: ProviderHealthState = {
                providerRegion, status: 'OPEN', consecutiveFailures: DEFAULT_FAILURE_THRESHOLD, 
                totalFailures: 3, totalSuccesses: 0, currentHalfOpenSuccesses: 0, 
                openedTimestamp: now - DEFAULT_COOLDOWN_PERIOD_MS - 1000, // Cooldown HAS passed
                lastStateChangeTimestamp: now - DEFAULT_COOLDOWN_PERIOD_MS, ttl: 0, totalLatencyMs: 0,
            };
            ddbMock.on(GetCommand).resolves({ Item: initialState });
            ddbMock.on(PutCommand).resolves({});
            jest.spyOn(console, 'log');

            const allowed = await manager.isRequestAllowed(providerRegion);

            expect(allowed).toBe(true);
            expect(ddbMock).toHaveReceivedCommandTimes(PutCommand, 1);
            const putCommandCalls = ddbMock.commandCalls(PutCommand);
            expect(putCommandCalls.length).toBe(1);
            const putArgs = putCommandCalls[0].args[0].input;
            expect(putArgs).toBeDefined();
            expect(putArgs.Item).toBeDefined();
            if (putArgs && putArgs.Item) { // Linter guard
                expect(putArgs.Item.status).toBe('HALF_OPEN');
                expect(putArgs.Item.consecutiveFailures).toBe(0);
                expect(putArgs.Item.currentHalfOpenSuccesses).toBe(0);
                expect(putArgs.Item.lastStateChangeTimestamp).toBe(now);
            }
            expect(console.log).toHaveBeenCalledWith(expect.stringContaining("transitioning from OPEN to HALF_OPEN after cooldown."));
        });

        it("should allow request if status is HALF_OPEN", async () => {
            const initialState: ProviderHealthState = {
                providerRegion, status: 'HALF_OPEN', consecutiveFailures: 0, totalFailures: 3, totalSuccesses: 0, 
                currentHalfOpenSuccesses: 0, lastStateChangeTimestamp: now -1000, ttl: 0, openedTimestamp: now - 2000,
                totalLatencyMs: 0,
            };
            ddbMock.on(GetCommand).resolves({ Item: initialState });
            jest.spyOn(console, 'log');

            const allowed = await manager.isRequestAllowed(providerRegion);
            expect(allowed).toBe(true);
            expect(ddbMock).not.toHaveReceivedCommand(PutCommand); // No state change just by allowing
            expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Allowing test request to TestProvider#test-region-1 in HALF_OPEN state."));
        });

        it("should block request for unknown status and log warning", async () => {
            const initialState = {
                providerRegion, status: 'UNKNOWN_STATUS', // Deliberately invalid status
            } as any; // Cast to any to bypass type checking for test
            ddbMock.on(GetCommand).resolves({ Item: initialState });
            const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {}); // Spy and suppress output

            const allowed = await manager.isRequestAllowed(providerRegion);
            expect(allowed).toBe(false);
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown status for TestProvider#test-region-1: UNKNOWN_STATUS. Blocking request."));
            warnSpy.mockRestore(); // Restore the original console.warn
        });
    });
}); 