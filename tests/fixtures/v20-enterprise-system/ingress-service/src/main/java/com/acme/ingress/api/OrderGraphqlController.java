package com.acme.ingress.api;

import com.acme.ingress.service.OrderService;
import org.springframework.graphql.data.method.annotation.QueryMapping;
import org.springframework.stereotype.Controller;

@Controller
public class OrderGraphqlController {
    private final OrderService service;
    public OrderGraphqlController(OrderService service) { this.service = service; }
    @QueryMapping(name = "order")
    public String loadOrder(String id) { return service.findForGraphql(id); }
}
