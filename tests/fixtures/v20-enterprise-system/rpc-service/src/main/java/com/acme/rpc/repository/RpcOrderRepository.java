package com.acme.rpc.repository;
import org.springframework.stereotype.Repository;
@Repository
public class RpcOrderRepository {
    public String find(String id) { return id; }
}
