package com.acme.rpc.service;
import com.acme.rpc.repository.RpcOrderRepository;
import org.springframework.stereotype.Service;
@Service
public class RpcOrderService {
    private final RpcOrderRepository repository;
    public RpcOrderService(RpcOrderRepository repository) { this.repository = repository; }
    public String find(String id) { return repository.find(id); }
}
