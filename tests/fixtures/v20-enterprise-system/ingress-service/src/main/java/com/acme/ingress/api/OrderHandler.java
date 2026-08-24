package com.acme.ingress.api;

import com.acme.ingress.service.OrderService;
import org.springframework.web.reactive.function.server.ServerRequest;
import org.springframework.web.reactive.function.server.ServerResponse;
import reactor.core.publisher.Mono;
import org.springframework.stereotype.Component;

@Component
public class OrderHandler {
    private final OrderService service;
    public OrderHandler(OrderService service) { this.service = service; }
    public Mono<ServerResponse> get(ServerRequest request) {
        return ServerResponse.ok().bodyValue(service.findForRoute(request.pathVariable("id")));
    }
}
