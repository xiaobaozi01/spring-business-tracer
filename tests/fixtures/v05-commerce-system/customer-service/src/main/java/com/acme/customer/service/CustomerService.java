package com.acme.customer.service;

import com.acme.customer.domain.CustomerAccount;
import com.acme.customer.repository.CustomerAccountRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CustomerService {
    private final CustomerAccountRepository repository;

    public CustomerService(CustomerAccountRepository repository) {
        this.repository = repository;
    }

    @Transactional(readOnly = true)
    public void requireActive(Long id) {
        CustomerAccount account = repository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("客户不存在"));
        if (!account.isActive()) {
            throw new IllegalStateException("客户未激活");
        }
    }
}
