package com.acme.customer.api;

import com.acme.customer.service.CustomerService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/internal/customers")
public class CustomerInternalController {
    private final CustomerService customerService;

    public CustomerInternalController(CustomerService customerService) {
        this.customerService = customerService;
    }

    @GetMapping("/{id}/active")
    public void requireActive(@PathVariable Long id) {
        customerService.requireActive(id);
    }
}
