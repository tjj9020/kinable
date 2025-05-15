# DynamoDB Partition Key Review Checklist

Before finalizing the design of a new DynamoDB table, review the following aspects of your chosen partition key (and sort key, if applicable):

## 1. Cardinality
- [ ] **High Cardinality?**: Does the partition key have a large number of distinct values relative to the total number of items in the table? (Aim for high cardinality to distribute data effectively).
- [ ] **Low Cardinality Risk**: If cardinality is low, have you considered the risk of "hot" partitions? What is the mitigation strategy?

## 2. Data Distribution
- [ ] **Even Distribution?**: Will item access patterns (reads and writes) be spread evenly across partition key values?
- [ ] **Hot Partition Risk**: Are there any foreseeable scenarios where a small number of partition key values will receive a disproportionately high volume of traffic?
    - [ ] If yes, what is the expected peak RCU/WCU for these hot partitions?
    - [ ] If yes, what strategies are in place to mitigate (e.g., write sharding, GSI for read offloading)?

## 3. Query Patterns
- [ ] **Primary Access Pattern**: Does the partition key (and sort key) directly support the most common and critical query patterns for this table?
- [ ] **Filtering**: Can you efficiently query data without requiring a full table scan or excessive filtering *after* retrieving items by partition key?
- [ ] **GSIs**: If primary keys don't support all query patterns, have necessary GSIs been identified?
    - [ ] Are GSI keys also reviewed against this checklist?

## 4. Item Size and Throughput
- [ ] **Item Collections**: If using sort keys, are item collections (items sharing the same partition key) expected to stay below the 10GB limit?
- [ ] **Single Partition Throughput**: Are expected RCU/WCU for any single partition key value within the limits (3000 RCU, 1000 WCU per physical partition)?

## 5. Key Design
- [ ] **Meaningful Keys**: Are the key attributes meaningful and derived from your domain entities?
- [ ] **Stability**: Are partition key values generally stable (i.e., not frequently updated)? Updating a primary key attribute requires deleting and re-inserting the item.
- [ ] **Global Table Readiness (if applicable)**:
    - [ ] Does the partition key design incorporate region information or another mechanism to ensure uniqueness if this table is intended for Global Table replication (e.g., `ENTITY#<region>#<id>`)?
    - [ ] Does the design adhere to write-locality principles if it's part of a multi-region active-active setup?

## 6. Scalability
- [ ] **Future Growth**: Does the key design accommodate significant future growth in data volume and request traffic?
- [ ] **Predictable Access**: Can you predict which partition key an item will belong to based on its attributes?

## Sign-off
- [ ] Reviewed by:
- [ ] Date:
- [ ] Decision/Notes: 